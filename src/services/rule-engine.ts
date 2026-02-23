// ═══════════════════════════════════════════
// VOUCH Rule Engine
// Evaluates agent action data against structured conditions
// This is what makes VOUCH a verifier, not just a logger.
// ═══════════════════════════════════════════

export interface Condition {
  field: string;
  op: '=' | '!=' | '<' | '<=' | '>' | '>=' | 'IN' | 'NOT IN' | 'CONTAINS' | 'NOT CONTAINS';
  value: any;
}

export interface EvalResult {
  field: string;
  op: string;
  expected: any;
  actual: any;
  pass: boolean;
}

export interface RuleEvaluation {
  rule_met: boolean;
  evaluation: EvalResult[];
  summary: string;
}

const VALID_OPS = new Set(['=', '!=', '<', '<=', '>', '>=', 'IN', 'NOT IN', 'CONTAINS', 'NOT CONTAINS']);

/**
 * Validate that conditions are well-formed before storing
 */
export function validateConditions(conditions: any[]): { valid: boolean; error?: string } {
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return { valid: false, error: 'Conditions must be a non-empty array' };
  }

  if (conditions.length > 20) {
    return { valid: false, error: 'Maximum 20 conditions per rule' };
  }

  for (let i = 0; i < conditions.length; i++) {
    const c = conditions[i];

    if (!c.field || typeof c.field !== 'string') {
      return { valid: false, error: `Condition ${i}: 'field' must be a non-empty string` };
    }

    if (!VALID_OPS.has(c.op)) {
      return { valid: false, error: `Condition ${i}: invalid operator '${c.op}'. Valid: ${[...VALID_OPS].join(', ')}` };
    }

    if (c.value === undefined) {
      return { valid: false, error: `Condition ${i}: 'value' is required` };
    }

    // IN / NOT IN require arrays
    if ((c.op === 'IN' || c.op === 'NOT IN') && !Array.isArray(c.value)) {
      return { valid: false, error: `Condition ${i}: '${c.op}' operator requires an array value` };
    }

    // Numeric operators require numeric values
    if (['<', '<=', '>', '>='].includes(c.op) && typeof c.value !== 'number') {
      return { valid: false, error: `Condition ${i}: '${c.op}' operator requires a numeric value` };
    }
  }

  return { valid: true };
}

/**
 * Evaluate rule conditions against agent action data.
 * All conditions are AND'd — every condition must pass for rule_met = true.
 */
export function evaluateRule(conditions: Condition[], actionData: Record<string, any>): RuleEvaluation {
  const results: EvalResult[] = conditions.map(cond => {
    const actual = actionData[cond.field];

    // Missing field = automatic fail
    if (actual === undefined || actual === null) {
      return {
        field: cond.field,
        op: cond.op,
        expected: cond.value,
        actual: null,
        pass: false
      };
    }

    let pass = false;

    switch (cond.op) {
      case '=':
        pass = actual === cond.value;
        break;
      case '!=':
        pass = actual !== cond.value;
        break;
      case '<':
        pass = Number(actual) < Number(cond.value);
        break;
      case '<=':
        pass = Number(actual) <= Number(cond.value);
        break;
      case '>':
        pass = Number(actual) > Number(cond.value);
        break;
      case '>=':
        pass = Number(actual) >= Number(cond.value);
        break;
      case 'IN':
        pass = Array.isArray(cond.value) && cond.value.includes(actual);
        break;
      case 'NOT IN':
        pass = Array.isArray(cond.value) && !cond.value.includes(actual);
        break;
      case 'CONTAINS':
        pass = typeof actual === 'string' && actual.includes(String(cond.value));
        break;
      case 'NOT CONTAINS':
        pass = typeof actual === 'string' && !actual.includes(String(cond.value));
        break;
      default:
        pass = false;
    }

    return {
      field: cond.field,
      op: cond.op,
      expected: cond.value,
      actual,
      pass
    };
  });

  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  const rule_met = total > 0 && results.every(r => r.pass);

  return {
    rule_met,
    evaluation: results,
    summary: rule_met
      ? `All ${total} condition${total > 1 ? 's' : ''} passed`
      : `${total - passed} of ${total} condition${total > 1 ? 's' : ''} failed`
  };
}
