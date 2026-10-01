export interface TeachingWeekRange {
  first: number;
  last: number;
}

export interface TeachingWeekRestriction {
  status: "unrestricted" | "resolved" | "ambiguous" | "unsupported";
  expressions: string[];
  ranges: TeachingWeekRange[];
}

function parseExpression(expression: string): TeachingWeekRange[] | null {
  const ranges: TeachingWeekRange[] = [];
  for (const token of expression.split(",")) {
    const match = token.trim().match(/^(?:[сc]\s*(\d{1,2})(?:\s*по\s*(\d{1,2}))?|по\s*(\d{1,2})|(\d{1,2})\.?)\s*нед(?:\.|ели|елю|ель)?$/iu);
    if (!match) return null;
    const first = match[1] ? Number(match[1]) : match[3] ? 1 : Number(match[4]);
    const last = match[1] ? match[2] ? Number(match[2]) : Infinity : Number(match[3] ?? match[4]);
    if (first < 1 || first > 53 || last < first || (Number.isFinite(last) && last > 53)) return null;
    ranges.push({ first, last });
  }
  return ranges.length ? ranges : null;
}

export function teachingWeekRestriction(rawText: string): TeachingWeekRestriction {
  const expressions = Array.from(rawText.matchAll(/\(([^()]*)\)/gu), (match) => match[1])
    .filter((expression) => /нед/iu.test(expression));
  if (!expressions.length) return { status: "unrestricted", expressions, ranges: [] };
  // Multiple periods may describe different subjects or teachers in one source cell.
  if (expressions.length > 1) return { status: "ambiguous", expressions, ranges: [] };
  const ranges = parseExpression(expressions[0]);
  return ranges ? { status: "resolved", expressions, ranges }
    : { status: "unsupported", expressions, ranges: [] };
}

export function appliesToTeachingWeek(rawText: string, weekNumber: number): boolean {
  const restriction = teachingWeekRestriction(rawText);
  return restriction.status !== "resolved"
    || restriction.ranges.some(({ first, last }) => weekNumber >= first && weekNumber <= last);
}
