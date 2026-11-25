// Checks orders before anything prices them.
import { readFileSync } from "node:fs";

// Returns a list of problems, empty when the order is fine.
export function validateOrder(order) {
  const problems = [];
  if (!order || !Array.isArray(order.items)) return ["the order has no items list"];
  if (order.items.length === 0) problems.push("the order has no items");
  const seen = new Set();
  order.items.forEach((item, i) => {
    const where = `item ${i + 1}`;
    if (typeof item.sku !== "string" || item.sku === "") problems.push(`${where}: no sku`);
    else if (seen.has(item.sku)) problems.push(`${where}: sku ${item.sku} appears twice`);
    else seen.add(item.sku);
    if (typeof item.name !== "string" || item.name === "") problems.push(`${where}: no name`);
    if (!Number.isInteger(item.unitPrice) || item.unitPrice < 0) problems.push(`${where}: unitPrice must be whole cents, 0 or more`);
    if (!Number.isInteger(item.qty) || item.qty < 1) problems.push(`${where}: qty must be a whole number, 1 or more`);
  });
  return problems;
}

// Reads an order file for the CLIs: { order } when it's fine, or { error } saying what's wrong.
export function loadOrder(file) {
  let order;
  try {
    order = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    return { error: `can't read ${file}: ${err.message}` };
  }
  const problems = validateOrder(order);
  if (problems.length) return { error: `${file}: ${problems.join("; ")}` };
  return { order };
}
