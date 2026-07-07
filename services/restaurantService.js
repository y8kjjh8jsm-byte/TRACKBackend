const restaurantDatabase = {
  "mcdonald": {
    aliases: ["mcdonald", "mcdonalds", "maccies", "big mac", "mcchicken", "fries"],
    foods: {
      "big mac": { calories: 493, protein: 26, carbs: 42, fat: 24 },
      "mcchicken": { calories: 400, protein: 20, carbs: 39, fat: 17 },
      "medium fries": { calories: 337, protein: 4, carbs: 42, fat: 17 },
      "large fries": { calories: 444, protein: 5, carbs: 55, fat: 22 }
    }
  },
  "nandos": {
    aliases: ["nando", "nandos", "peri peri", "perinaise"],
    foods: {
      "grilled chicken": { calories: 240, protein: 35, carbs: 0, fat: 11 },
      "peri peri chips": { calories: 460, protein: 6, carbs: 58, fat: 22 }
    }
  },
  "five guys": {
    aliases: ["five guys", "cheeseburger", "cajun fries"],
    foods: {
      "cheeseburger": { calories: 840, protein: 47, carbs: 40, fat: 55 },
      "fries": { calories: 530, protein: 8, carbs: 72, fat: 23 }
    }
  }
};

function detectRestaurant(meal) {
  const text = `${meal.name || ""} ${(meal.notes || "")} ${(meal.components || []).map(c => c.name).join(" ")}`.toLowerCase();

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
