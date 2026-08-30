function confidenceToScore(confidence) {
  const value = String(confidence || "medium").toLowerCase();

  if (value === "high") return 0.9;
  if (value === "low") return 0.45;

  return 0.7;
}

function sourceToScore(source) {
  if (source === "USDA") return 0.95;
  if (source === "Open Food Facts") return 0.85;
  if (source === "TRACK database") return 0.75;
  if (source === "AI fallback") return 0.45;

  return 0.6;
}

function applyConfidenceScores(meal) {
  const components = meal.components.map((component) => {
    const visionScore = confidenceToScore(component.confidence);
    const sourceScore = sourceToScore(component.source);
    const finalScore = Math.round(((visionScore + sourceScore) / 2) * 100);

    return {
      ...component,
      confidenceScore: finalScore
    };
  });

  const overall =
    components.length > 0
      ? Math.round(
          components.reduce((sum, c) => sum + c.confidenceScore, 0) / components.length
        )
      : 60;

  return {
    ...meal,
    confidenceScore: overall,
    components
  };
}

module.exports = {
  applyConfidenceScores
};
