
export default async function handler(req, res) {
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

    const safeHistory = Array.isArray(history)
      ? history
          .filter(
            item =>
              item &&
              ["user", "assistant"].includes(item.role) &&
              typeof item.content === "string"
          )
          .slice(-12)
          .map(item => ({
            role: item.role,
            content: item.content.slice(0, 6000)
          }))
      : [];

    const input = {
      system_prompt:
        "You are a helpful AI assistant inside NotePad. Help with meeting notes, summaries, story writing, studying, and improving text. Be clear, accurate, and friendly. Use readable Markdown when useful.",

      messages: JSON.stringify([
        ...safeHistory,
        {
          role: "user",
          content: message.trim().slice(0, 12000)
        }
      ]),

      max_completion_tokens: 2048
    };

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

    function extractReply(output) {
      if (typeof output === "string") {
        return output;
      }

      if (Array.isArray(output)) {
        return output
          .map(item =>
            typeof item === "string" ? item : ""
          )
          .join("");
      }

      return "";
    }

    let reply = extractReply(data.output);

    if (data.status === "succeeded") {
      if (!reply.trim()) {
        return res.status(502).json({
          error: "Replicate completed but returned no text."
        });
      }

      return res.status(200).json({ reply });
    }

    if (
      data.status === "failed" ||
      data.status === "canceled"
    ) {
      console.error("Prediction failed:", data);

      return res.status(502).json({
        error: "The AI prediction failed. Please try again."
      });
    }

    if (data.status === "starting" || data.status === "processing") {
      if (!data.urls?.get) {
        return res.status(502).json({
          error: "Replicate did not provide a prediction status URL."
        });
      }

      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        const pollResponse = await fetch(data.urls.get, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        const pollData = await pollResponse.json().catch(() => ({}));

        if (!pollResponse.ok) {
          console.error("Polling error:", pollData);

          return res.status(502).json({
            error: "Could not retrieve the AI response."
          });
        }

        if (pollData.status === "succeeded") {
          reply = extractReply(pollData.output);

          if (!reply.trim()) {
            return res.status(502).json({
              error: "The AI completed but returned no text."
            });
          }

          return res.status(200).json({ reply });
        }

        if (
          pollData.status === "failed" ||
          pollData.status === "canceled"
        ) {
          console.error("Prediction failed:", pollData);

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
      error: "Unexpected prediction status: " + (data.status || "unknown")
    });

  } catch (error) {
    console.error("Chat API error:", error);

    return res.status(500).json({
      error: "A server error occurred while contacting the AI."
    });
  }
}
