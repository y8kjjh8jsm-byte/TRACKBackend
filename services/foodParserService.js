function cleanAIJson(text) {
  return text.replace(/```json/g, "").replace(/```/g, "").trim();
}

async function parseFoodSearch(openai, query) {
  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `
You are TRACK's food search parser.

Parse this user food search into structured JSON.

User search:
"${query}"

Return ONLY valid JSON:

{
  "rawQuery": "",
  "brand": "",
  "foodName": "",
  "category": "",
  "size": "",
  "quantity": 1,
  "unit": "",
  "milk": "",
  "extras": [],
  "removals": [],
  "isRestaurantItem": false,
  "isGenericFood": false,
  "confidence": "medium"
}

Rules:
- Understand searches like "large banana", "1 chicken breast", "grande starbucks iced latte oat milk extra caramel".
- Detect brands like Starbucks, Costa, Caffe Nero, McDonald's, KFC, Subway, Nando's.
- Detect sizes: small, medium, large, tall, grande, venti.
- Detect milk: oat, almond, soy, coconut, whole milk, skimmed.
- Detect extras: extra shot, caramel, vanilla syrup, whipped cream, drizzle, sauce.
- Detect removals: no cream, no mayo, no syrup.
`
          }
        ]
      }
    ]
  });

  return JSON.parse(cleanAIJson(response.output_text));
}

module.exports = {
  parseFoodSearch
};
