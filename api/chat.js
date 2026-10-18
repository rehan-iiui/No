
export default async function handler(req, res) {
  // Allow chat requests only through POST.
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Method not allowed. Use POST."
    });
  }

  try {
    const token = process.env.REPLICATE_API_TOKEN;

    if (!token) {
      return res.status(500).json({
        error: "Missing REPLICATE_API_TOKEN in Vercel environment variables."
      });
    }

    const { message, history = [] } = req.body || {};

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        error: "Please enter a message."
      });
    }

    // Keep conversation history small and accept only valid messages.
    const safeHistory = Array.isArray(history)
      ? history
          .filter(
            (item) =>
              item &&
              ["user", "assistant"].includes(item.role) &&
              typeof item.content === "string"
          )
          .slice(-12)
          .map((item) => ({
            role: item.role,
            content: item.content.slice(0, 6000)
          }))
      : [];

    const input = {
      prompt: [
        {
          role: "system",
          content:
            "You are a helpful AI assistant inside NotePad. Help with meeting notes, summaries, story writing, studying, and improving text. Be clear, accurate, and friendly. Use readable Markdown when useful."
        },
        ...safeHistory,
        {
          role: "user",
          content: message.trim().slice(0, 12000)
        }
      ]
    };

    // Start a prediction using Replicate's model API.
    const response = await fetch(
      "https://api.replicate.com/v1/models/openai/gpt-4.1-nano/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "wait"
        },
        body: JSON.stringify({ input })
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("Replicate API error:", data);
      return res.status(response.status).json({
        error:
          data.detail ||
          data.title ||
          "Replicate could not generate a response. Check your token and model."
      });
    }

    // Replicate may return output as a string or an array of text chunks.
    const output = data.output;
    const reply = Array.isArray(output)
      ? output.join("")
      : typeof output === "string"
        ? output
        : "";

    if (reply) {
      return res.status(200).json({ reply });
    }

    // If the prediction is still running, poll its status URL.
    if (data.status === "starting" || data.status === "processing") {
      if (!data.urls?.get) {
        return res.status(502).json({
          error: "Replicate is still processing but provided no status URL."
        });
      }

      for (let attempt = 0; attempt < 25; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const pollResponse = await fetch(data.urls.get, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        const pollData = await pollResponse.json().catch(() => ({}));

        if (!pollResponse.ok) {
          console.error("Replicate polling error:", pollData);
          return res.status(502).json({
            error: "Could not retrieve the Replicate response."
          });
        }

        if (pollData.status === "succeeded") {
          const result = Array.isArray(pollData.output)
            ? pollData.output.join("")
            : typeof pollData.output === "string"
              ? pollData.output
              : "";

          if (!result) {
            return res.status(502).json({
              error: "Replicate completed but returned no text."
            });
          }

          return res.status(200).json({ reply: result });
        }

        if (
          pollData.status === "failed" ||
          pollData.status === "canceled"
        ) {
          console.error("Replicate prediction failed:", pollData);
          return res.status(502).json({
            error: "The AI prediction failed. Please try again."
          });
        }
      }

      return res.status(504).json({
        error: "The AI is taking too long. Please try again."
      });
    }

    return res.status(502).json({
      error: "Replicate returned no text. Check the model's expected input format."
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return res.status(500).json({
      error: "A server error occurred while contacting the AI."
    });
  }
}
