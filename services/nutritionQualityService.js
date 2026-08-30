function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fold(value = "") {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function macroCalories(item) {
  return num(item?.protein) * 4 + num(item?.carbs) * 4 + num(item?.fat) * 9;
}

function macroEnergyRatio(item) {
  const calories = num(item?.calories);
  const fromMacros = macroCalories(item);
  if (calories <= 0 || fromMacros <= 0) return null;
  return fromMacros / calories;
}

function nutritionAudit(item, { strict = false } = {}) {
  const calories = num(item?.calories, -1);
  const protein = num(item?.protein, -1);
  const carbs = num(item?.carbs, -1);
  const fat = num(item?.fat, -1);
  const reasons = [];

  if ([calories, protein, carbs, fat].some(value => value < 0)) reasons.push("negative_nutrition");
  if (calories === 0 && protein === 0 && carbs === 0 && fat === 0) reasons.push("empty_nutrition");
  if (calories > 6000 || protein > 500 || carbs > 1000 || fat > 500) reasons.push("absolute_outlier");

  const ratio = macroEnergyRatio({ calories, protein, carbs, fat });
  if (calories >= 80 && ratio !== null) {
    const lower = strict ? 0.62 : 0.55;
    const upper = strict ? 1.42 : 1.55;
    if (ratio < lower || ratio > upper) reasons.push("macro_calorie_mismatch");
  }

  return {
    ok: reasons.length === 0,
    reasons,
    macroCalories: Math.round(macroCalories({ protein, carbs, fat })),
    macroEnergyRatio: ratio
  };
}

function foodClass(text = "") {
  const t = fold(text);
  if (/\b(oil|olive oil|ghee|butter|mayo|mayonnaise)\b/.test(t)) return "fat";
  if (/\b(sauce|dressing|dip|gravy)\b/.test(t)) return "sauce";
  if (/\b(fries|chips|wedges)\b/.test(t)) return "fries";
  if (/\b(bread|toast|garlic bread|naan|pita|bun|roll)\b/.test(t)) return "bread";
  if (/\b(chicken|beef|steak|lamb|pork|turkey|fish|salmon|tuna|meat)\b/.test(t)) return "protein";
  if (/\b(rice|pasta|noodle|couscous|quinoa|potato|potatoes)\b/.test(t)) return "starch";
  if (/\b(cheese|halloumi|mozzarella|cheddar)\b/.test(t)) return "cheese";
  if (/\b(coffee|latte|tea|juice|cola|drink|smoothie|shake|water)\b/.test(t)) return "drink";
  if (/\b(salad|vegetable|vegetables|broccoli|greens|fruit|banana|apple)\b/.test(t)) return "produce";
  return "other";
}

const PORTION_BOUNDS = {
  fat: [2, 80],
  sauce: [5, 180],
  fries: [25, 500],
  bread: [15, 450],
  protein: [20, 800],
  starch: [25, 800],
  cheese: [5, 300],
  drink: [30, 1600],
  produce: [15, 1000],
  other: [10, 1200]
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sanitizeVisualPortion(item = {}) {
  const klass = foodClass(`${item.name || ""} ${item.preparation || ""}`);
  const [classLow, classHigh] = PORTION_BOUNDS[klass] || PORTION_BOUNDS.other;

  const rawMid = num(item.estimatedGrams, 0);
  const rawLow = num(item.estimatedGramsLow, 0);
  const rawHigh = num(item.estimatedGramsHigh, 0);

  let low = rawLow > 0 ? rawLow : rawMid > 0 ? rawMid * 0.72 : classLow;
  let high = rawHigh > 0 ? rawHigh : rawMid > 0 ? rawMid * 1.28 : classHigh;
  low = clamp(low, classLow, classHigh);
  high = clamp(high, low, classHigh);
  let grams = rawMid > 0 ? clamp(rawMid, low, high) : (low + high) / 2;

  // Vision can occasionally return wildly large weights. Class bounds prevent one
  // uncertain oil/sauce/cheese estimate from dominating the entire meal.
  grams = clamp(grams, classLow, classHigh);

  return {
    grams,
    low,
    high,
    foodClass: klass,
    wasClamped: rawMid > 0 && Math.abs(rawMid - grams) > 0.5
  };
}

function servingMetricGrams(result = {}) {
  const amount = num(result.metricAmount, 0);
  const unit = fold(result.metricUnit || "");
  if (amount <= 0) return 0;
  if (unit === "g" || unit === "gram" || unit === "grams") return amount;
  if (unit === "kg" || unit === "kilogram" || unit === "kilograms") return amount * 1000;
  // For food/drink estimation, 1 mL ~= 1 g is a useful approximation for portion scaling.
  if (unit === "ml" || unit === "milliliter" || unit === "milliliters" || unit === "millilitre" || unit === "millilitres") return amount;
  return 0;
}

function scaleNutrition(result, factor) {
  return {
    calories: num(result.calories) * factor,
    protein: num(result.protein) * factor,
    carbs: num(result.carbs) * factor,
    fat: num(result.fat) * factor
  };
}

function resolveVisualNutrition(result, item = {}) {
  const quantity = clamp(num(item.quantity, 1), 0.25, 20);
  const portion = sanitizeVisualPortion(item);
  const metricGrams = servingMetricGrams(result);
  let factor = quantity;
  let scalingBasis = "serving_quantity";

  if (metricGrams > 0 && portion.grams > 0) {
    // Use the photographed edible amount when FatSecret tells us how many grams its
    // nutrition serving represents. Broad caps avoid turning a noisy visual gram estimate
    // into a many-fold nutrition error.
    const visualFactor = portion.grams / metricGrams;
    // estimatedGrams represents the TOTAL visible edible amount for this component,
    // including all visible pieces. Do not multiply by quantity again here.
    factor = clamp(visualFactor, 0.2, 5);
    scalingBasis = "visual_grams_vs_database_serving";
  }

  const nutrition = scaleNutrition(result, factor);
  const audit = nutritionAudit(nutrition, { strict: true });
  return { ...nutrition, factor, quantity, portion, metricGrams, scalingBasis, audit };
}

function reconcileEstimatedNutrition(item) {
  const audit = nutritionAudit(item, { strict: true });
  if (audit.ok) return { ...item, nutritionAudit: audit, reconciled: false };

  // Only estimates (never verified database or label values) may have calories reconciled
  // from their own macros. This fixes arithmetic inconsistency without inventing macros.
  if (item?.verified || /label/i.test(String(item?.source || ""))) {
    return { ...item, nutritionAudit: audit, rejected: true };
  }

  const fromMacros = audit.macroCalories;
  if (fromMacros > 0 && !audit.reasons.some(reason => reason !== "macro_calorie_mismatch")) {
    const corrected = { ...item, calories: fromMacros };
    return {
      ...corrected,
      nutritionAudit: nutritionAudit(corrected, { strict: true }),
      reconciled: true,
      reconciliationReason: "calories_recomputed_from_macros"
    };
  }

  return { ...item, nutritionAudit: audit, rejected: true };
}

function mealPlausibility(result, components = []) {
  const audit = nutritionAudit(result, { strict: true });
  const totalGrams = components.reduce((sum, component) => sum + num(component.estimatedGrams, 0), 0);
  const caloriesPerGram = totalGrams > 0 ? num(result.calories) / totalGrams : null;
  const fatPerGram = totalGrams > 0 ? num(result.fat) / totalGrams : null;
  const text = fold(components.map(c => `${c.name || ""} ${c.preparation || ""}`).join(" "));
  const explicitlyFatDense = /\b(oil|butter|ghee|mayo|mayonnaise|cheese|nuts|peanut|fried|deep fried)\b/.test(text);
  const reasons = [...audit.reasons];

  if (caloriesPerGram !== null && caloriesPerGram > 6.8 && !explicitlyFatDense) reasons.push("implausible_meal_energy_density");
  if (fatPerGram !== null && fatPerGram > 0.38 && !explicitlyFatDense) reasons.push("implausible_meal_fat_density");
  if (totalGrams > 0 && totalGrams > 3500) reasons.push("implausible_visible_meal_mass");

  return {
    ok: reasons.length === 0,
    reasons: [...new Set(reasons)],
    macroCalories: audit.macroCalories,
    macroEnergyRatio: audit.macroEnergyRatio,
    totalEstimatedGrams: Math.round(totalGrams),
    caloriesPerGram,
    fatPerGram
  };
}

module.exports = {
  macroCalories,
  macroEnergyRatio,
  nutritionAudit,
  foodClass,
  sanitizeVisualPortion,
  servingMetricGrams,
  resolveVisualNutrition,
  reconcileEstimatedNutrition,
  mealPlausibility
};
