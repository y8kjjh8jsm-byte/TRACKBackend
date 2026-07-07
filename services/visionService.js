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
You are TRACK's premium food vision engine.

Detect every visible food component in the image.

Return ONLY valid JSON.

Your job:
- Identify every visible food item.
- Estimate edible grams for each item.
- Use visual portion clues such as plate size, bowl size, hand/utensil size, food height, and relative area.
- If a plate is visible, estimate whether it is small, medium, or large.
- If a bowl is visible, estimate whether it is small, medium, or large.
- Include likely hidden fats such as oil, butter or ghee.
- If meat is bone-in, estimate edible meat only.
- Do not calculate final nutrition.
- Do not ignore protein sources.
- Do not call a rice-and-meat meal only rice.
- If the food appears to be from a restaurant or branded chain, mention the restaurant name if visible or strongly suggested.
- Be realistic with portion sizes.
- Give confidence as low, medium or high.

Return this exact JSON:

{
  "name": "",
  "serving": "",
  "restaurantHint": "",
  "plateSize": "",
  "confidence": "",
  "notes": "",
  "components": [
    {
      "name": "",
      "estimatedGrams": 0,
      "portionClue": "",
      "confidence": ""
    }
  ]
}

Examples:
- If it is McDonald's fries, use name "medium fries" or "large fries" if size is visible.
- If it is Nando's chicken and chips, mention "nandos" in restaurantHint.
- If it is rice with lamb, separate rice, lamb, and cooking fat.
- If meat pieces are visible, estimate total edible meat grams carefully.
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
