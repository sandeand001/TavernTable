export function copyRollSummary(summary) {
  if (
    !summary ||
    typeof summary !== 'object' ||
    Array.isArray(summary) ||
    Object.keys(summary).some((key) => !['label', 'total', 'breakdown'].includes(key)) ||
    typeof summary.label !== 'string' ||
    summary.label.length > 1000 ||
    !Number.isSafeInteger(summary.total) ||
    typeof summary.breakdown !== 'string' ||
    !summary.breakdown.length ||
    summary.breakdown.length > 10000
  ) {
    throw new Error('The roll summary has invalid fields');
  }
  return { label: summary.label, total: summary.total, breakdown: summary.breakdown };
}

export function buildRollBreakdown({ expression, terms, mode, total, physical, digitalReason }) {
  const equation = terms
    .map((term, index) => {
      const constant = term.constant !== undefined;
      const negative = constant ? term.constant < 0 : term.sign < 0;
      const sign = index === 0 ? (negative ? '-' : '') : negative ? ' - ' : ' + ';
      if (constant) return `${sign}${Math.abs(term.constant)}`;
      const kept =
        mode === 'normal'
          ? ''
          : ` (keep ${mode === 'advantage' ? Math.max(...term.values) : Math.min(...term.values)})`;
      return `${sign}${term.count}d${term.sides} [${term.values.join(', ')}]${kept}`;
    })
    .join('');
  const source = physical
    ? 'Physical d20'
    : digitalReason
      ? 'Digital; 3D unavailable'
      : terms.every((term) => term.constant !== undefined)
        ? 'Fixed value'
        : mode === 'advantage'
          ? 'Advantage (digital)'
          : mode === 'disadvantage'
            ? 'Disadvantage (digital)'
            : 'Digital';
  return `${expression}\n${equation} = ${total}\n${source}`;
}
