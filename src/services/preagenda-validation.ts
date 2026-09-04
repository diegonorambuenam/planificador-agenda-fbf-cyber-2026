export type ValidationKind = 'fbf' | 'commercial';
export interface PreagendaValidation {
  number: string; kind: ValidationKind; approved: boolean; revision: string;
  updated_at: string; updated_by: string | null;
}
export type ValidationMap = Record<string, PreagendaValidation>;
export const validationKey = (number: string, kind: ValidationKind) => JSON.stringify([number, kind]);
export function parseValidations(value: unknown): ValidationMap {
  if (!Array.isArray(value)) throw new Error('Invalid validations');
  const result: ValidationMap = {};
  for (const row of value) {
    if (!row || typeof row.number !== 'string' || !row.number || !['fbf','commercial'].includes(row.kind) ||
      typeof row.approved !== 'boolean' || typeof row.revision !== 'string' || !/^[a-f\d-]{36}$/i.test(row.revision) ||
      typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at)) ||
      !(row.updated_by === null || typeof row.updated_by === 'string')) throw new Error('Invalid validation');
    const key = validationKey(row.number, row.kind);
    if (result[key]) throw new Error('Duplicate validation');
    result[key] = row;
  }
  return result;
}
export function isValidated(rows: ValidationMap, number: string, kind: ValidationKind) {
  return rows[validationKey(number, kind)]?.approved === true;
}
