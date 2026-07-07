function round(value) {
  return Math.round(Number(value) || 0);
}

const milkAdjustments = {
  oat: { calories: 60, protein: 1, carbs: 9, fat: 2 },
  almond: { calories: 25, protein: 1, carbs: 1, fat: 2 },
  soy: { calories: 50, protein: 4, carbs: 4, fat: 2 },
  coconut: { calories: 45, protein: 0, carbs: 2, fat: 4 },
  "whole milk": { calories: 70, protein: 4, carbs: 5, fat: 4 },
  skimmed: { calories: 40, protein: 4, carbs: 5, fat: 0 }
};

const extraAdjustments = {
  "extra shot": { calories: 5, protein: 0, carbs: 1, fat: 0 },
  caramel: { calories: 55, protein: 0, carbs: 14, fat: 0 },
  vanilla: { calories: 40, protein: 0, carbs: 10, fat: 0 },
  "vanilla syrup": { calories: 40, protein: 0, carbs: 10, fat: 0 },
  "whipped cream": { calories: 80, protein: 1, carbs: 4, fat: 7 },
  drizzle: { calories: 45, protein: 0, carbs: 11, fat: 0 },
  sauce: { calories: 50, protein: 0, carbs: 10, fat: 1 }
};

function applyAdjustment(total, adjustment, multiplier = 1) {
  return {
    calories: total.calories + round(adjustment.calories * multiplier),
    protein: total.protein + round(adjustment.protein * multiplier),
    carbs: total.carbs + round(adjustment.carbs * multiplier),
    fat: total.fat + round(adjustment.fat * multiplier)
  };
}

function buildCustomisedNutrition(baseNutrition, parsed) {
  let total = {
    calories: round(baseNutrition.calories),
    protein: round(baseNutrition.protein),
    carbs: round(baseNutrition.carbs),
    fat: round(baseNutrition.fat)
  };

  const milk = String(parsed.milk || "").toLowerCase();
  const milkMatch = Object.keys(milkAdjustments).find(key => milk.includes(key));

  if (milkMatch) {
    total = applyAdjustment(total, milkAdjustments[milkMatch]);
  }

  const extras = Array.isArray(parsed.extras) ? parsed.extras : [];

  extras.forEach(extra => {
    const lower = String(extra).toLowerCase();
    const match = Object.keys(extraAdjustments).find(key => lower.includes(key));

    if (match) {
      const multiplier = lower.includes("extra") ? 2 : 1;
      total = applyAdjustment(total, extraAdjustments[match], multiplier);
    }
  });

  const removals = Array.isArray(parsed.removals) ? parsed.removals : [];

  removals.forEach(removal => {
    const lower = String(removal).toLowerCase();

    if (lower.includes("cream")) {
      total.calories = Math.max(0, total.calories - 80);
      total.fat = Math.max(0, total.fat - 7);
    }

    if (lower.includes("syrup")) {
      total.calories = Math.max(0, total.calories - 40);
      total.carbs = Math.max(0, total.carbs - 10);
    }

    if (lower.includes("mayo")) {
      total.calories = Math.max(0, total.calories - 90);
      total.fat = Math.max(0, total.fat - 10);
    }
  });

  return total;
}

module.exports = {
  buildCustomisedNutrition
};
