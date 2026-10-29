type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const identifier = (...values: unknown[]) => values.map(text).find((value) => value && value !== "00000000-0000-0000-0000-000000000000") ?? "";

export function allotmentsOf(value: unknown): { id: string; name: string; quantity: number }[] {
  const rate = object(value);
  const direct = array(rate.allotments);
  const rows = direct.length ? direct : array(object(rate.rateAvailablity).allotments);
  const result = new Map<string, { id: string; name: string; quantity: number }>();
  for (const value of rows) {
    const row = object(value);
    const id = identifier(row.allotmentId, row.id);
    if (!id || typeof row.quantity !== "number" || !Number.isInteger(row.quantity) || row.quantity < 0) continue;
    const previous = result.get(id);
    result.set(id, { id, name: text(row.name) || text(row.code) || id, quantity: Math.min(row.quantity, previous?.quantity ?? row.quantity) });
  }
  return [...result.values()];
}

export function rateIdsOf(value: unknown) {
  const rate = object(value);
  const nested = object(rate.rateAvailablity);
  const plan = object(rate.ratePlan ?? nested.ratePlan);
  return {
    roomTypeId: identifier(rate.roomTypeId, rate.roomTypeID, object(rate.roomType).roomTypeID, nested.roomTypeId),
    ratePlanId: identifier(rate.ratePlanId, rate.ratePlanID, plan.ratePlanId, plan.id, nested.ratePlanId),
  };
}
