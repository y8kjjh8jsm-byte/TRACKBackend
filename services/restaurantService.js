const restaurantDatabase = {
  "mcdonalds": {
    aliases: ["mcdonald", "mcdonalds", "maccies", "big mac", "mcchicken", "mcnuggets"],
    foods: {
      "big mac": { calories: 493, protein: 26, carbs: 42, fat: 24 },
      "mcchicken": { calories: 400, protein: 20, carbs: 39, fat: 17 },
      "cheeseburger": { calories: 301, protein: 16, carbs: 31, fat: 12 },
      "hamburger": { calories: 251, protein: 13, carbs: 30, fat: 8 },
      "medium fries": { calories: 337, protein: 4, carbs: 42, fat: 17 },
      "large fries": { calories: 444, protein: 5, carbs: 55, fat: 22 },
      "mcnuggets": { calories: 261, protein: 14, carbs: 16, fat: 15 }
    }
  },
  "nandos": {
    aliases: ["nando", "nandos", "peri peri", "perinaise"],
    foods: {
      "grilled chicken": { calories: 240, protein: 35, carbs: 0, fat: 11 },
      "chicken breast": { calories: 298, protein: 45, carbs: 1, fat: 12 },
      "quarter chicken": { calories: 265, protein: 34, carbs: 0, fat: 14 },
      "peri peri chips": { calories: 460, protein: 6, carbs: 58, fat: 22 },
      "spicy rice": { calories: 246, protein: 5, carbs: 45, fat: 4 },
      "perinaise": { calories: 150, protein: 0, carbs: 2, fat: 16 }
    }
  },
  "five guys": {
    aliases: ["five guys", "cajun fries", "five guys burger"],
    foods: {
      "hamburger": { calories: 700, protein: 39, carbs: 39, fat: 43 },
      "cheeseburger": { calories: 840, protein: 47, carbs: 40, fat: 55 },
      "bacon cheeseburger": { calories: 920, protein: 51, carbs: 40, fat: 62 },
      "fries": { calories: 530, protein: 8, carbs: 72, fat: 23 },
      "cajun fries": { calories: 530, protein: 8, carbs: 72, fat: 23 }
    }
  },
  "subway": {
    aliases: ["subway", "footlong", "six inch", "6 inch"],
    foods: {
      "chicken tikka": { calories: 308, protein: 24, carbs: 45, fat: 5 },
      "turkey breast": { calories: 280, protein: 18, carbs: 46, fat: 4 },
      "tuna": { calories: 480, protein: 25, carbs: 44, fat: 25 },
      "italian bmt": { calories: 410, protein: 20, carbs: 46, fat: 16 }
    }
  },
  "kfc": {
    aliases: ["kfc", "kentucky fried chicken", "zinger"],
    foods: {
      "zinger burger": { calories: 450, protein: 26, carbs: 45, fat: 18 },
      "fried chicken": { calories: 320, protein: 28, carbs: 10, fat: 20 },
      "popcorn chicken": { calories: 390, protein: 24, carbs: 24, fat: 22 },
      "fries": { calories: 300, protein: 4, carbs: 38, fat: 14 }
    }
  }
};

function detectRestaurant(meal) {
  const text = `${meal.restaurantHint || ""} ${meal.name || ""} ${meal.notes || ""} ${(meal.components || []).map(c => c.name).join(" ")}`.toLowerCase();

  for (const [restaurant, data] of Object.entries(restaurantDatabase)) {
    if (data.aliases.some(alias => text.includes(alias))) {
      return restaurant;
    }
  }

  return null;
}

function getRestaurantNutrition(componentName, restaurant) {
  if (!restaurant) return null;

  const foods = restaurantDatabase[restaurant]?.foods || {};
  const lower = componentName.toLowerCase();

  const matchKey = Object.keys(foods).find(key => lower.includes(key));

  if (!matchKey) return null;

  return {
    ...foods[matchKey],
    source: `Restaurant database: ${restaurant}`
  };
}

module.exports = {
  detectRestaurant,
  getRestaurantNutrition
};
