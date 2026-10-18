
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed. Use POST."
    });
  }

  const token = process.env.REPLICATE_API_TOKEN;

  if (!token) {
    return res.status(500).json({
      error: "REPLICATE_API_TOKEN is missing from Vercel Environment Variables."
    });
  }

  try {
    const { message, history = [] } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Please provide a message as text."
      });
    }

    // Build messages as an ARRAY of role/content objects.
    const messages = [
      {
        role: "system",
        content:
          "You are a helpful AI assistant inside a notes app. Help with meeting notes, story summaries, writing, studying, and organizing ideas. Be clear and useful."
      },
      ...history
        .filter(
          item =>
            item &&
            ["user", "assistant"].includes(item.role) &&
            typeof item.content === "string"
        )
        .map(item => ({
          role: item.role,
          content: item.content
        })),
      {
        role: "user",
        content: message
      }
    ];

    const response = await fetch(
      "https://api.replicate.com/v1/models/openai/gpt-4.1-nano/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "wait"
        },
        body: JSON.stringify({
          input: {
            messages: messages
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Replicate API error:", data);

      return res.status(response.status).json({
        error:
          data?.detail ||
          data?.title ||
          data?.error ||
          "Replicate rejected the request."
      });
    }

    let output = data.output;

    // Handle models that return an array of output chunks.
    if (Array.isArray(output)) {
      output = output.join("");
    }

    // Handle models that return an object.
    if (output && typeof output === "object") {
      output =
        output.text ||
        output.content ||
        output.message ||
        JSON.stringify(output);
    }

    if (typeof output !== "string" || !output.trim()) {
      console.error("Unexpected Replicate response:", data);

      return res.status(502).json({
        error:
          "The model returned no text. Check the Replicate model's required input format and deployment logs."
      });
    }

    return res.status(200).json({
      reply: output.trim()
    });
  } catch (error) {
    console.error("Chat API error:", error);

    return res.status(500).json({
      error: error.message || "An unexpected server error occurred."
    });
  }
}
