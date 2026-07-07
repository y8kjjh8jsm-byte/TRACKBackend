function cleanAIJson(text) {
  return text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
}

async function detectFoodComponents(openai, image) {
  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `
You are TRACK's food vision engine.

Detect every visible food component in the image.

Return ONLY valid JSON.

Your job:
- Identify every visible food item.
- Estimate edible grams for each item.
- Include likely hidden fats such as oil, butter or ghee.
- If meat is bone-in, estimate edible meat only.
- Do not calculate final nutrition.
- Do not ignore protein sources.
- Do not call a rice-and-meat meal only rice.
- Be realistic with portion sizes.
- Give confidence as low, medium or high.

Return this exact JSON:

{
  "name": "",
  "serving": "",
  "confidence": "",
  "notes": "",
  "components": [
    {
      "name": "",
      "estimatedGrams": 0,
      "confidence": ""
    }
  ]
}
`
          },
          {
            type: "input_image",
            image_url: image
          }
        ]
      }
    ]
  });

  const cleaned = cleanAIJson(response.output_text);
  return JSON.parse(cleaned);
}

module.exports = {
  detectFoodComponents
};
