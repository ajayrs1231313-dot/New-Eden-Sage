export type ShoppingListAdd = { typeId:number; name:string; quantity:number };
export type ShoppingItem = { id:string; typeId:number; name:string; quantity:number; done:boolean; addedAt:string };

export const SHOPPING_LIST_STORAGE_KEY = "new-eden-sage-shopping-list-v1";
export const SHOPPING_LIST_UPDATED_EVENT = "sage:shopping-list-updated";
export const OPEN_SHOPPING_LIST_EVENT = "sage:open-shopping-list";
export const OPEN_SHOPPING_LIST_PENDING_KEY = "new-eden-sage-open-shopping-list";

export function loadShoppingList(): ShoppingItem[] {
  try {
    const value = JSON.parse(localStorage.getItem(SHOPPING_LIST_STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function saveShoppingList(items: ShoppingItem[]) {
  localStorage.setItem(SHOPPING_LIST_STORAGE_KEY, JSON.stringify(items));
}

function makeId(typeId:number, index:number) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${typeId}:${Date.now()}:${index}`;
}

export function mergeShoppingList(current:ShoppingItem[], additions:ShoppingListAdd[]) {
  const grouped = new Map<number, ShoppingListAdd>();
  for (const input of additions) {
    const typeId = Number(input.typeId);
    const quantity = Math.max(1, Math.floor(Number(input.quantity) || 1));
    if (!Number.isInteger(typeId) || typeId <= 0) continue;
    const existing = grouped.get(typeId);
    if (existing) existing.quantity += quantity;
    else grouped.set(typeId, { typeId, name: String(input.name || `Type ${typeId}`), quantity });
  }
  let next = [...current];
  let index = 0;
  for (const input of grouped.values()) {
    const existing = next.find((item) => item.typeId === input.typeId && !item.done);
    if (existing) {
      next = next.map((item) => item.id === existing.id ? { ...item, quantity: item.quantity + input.quantity, name: input.name || item.name } : item);
    } else {
      next.push({ id: makeId(input.typeId, index++), typeId: input.typeId, name: input.name, quantity: input.quantity, done: false, addedAt: new Date().toISOString() });
    }
  }
  return next;
}

export function appendShoppingList(additions:ShoppingListAdd[], message?:string) {
  const valid = additions.filter((item) => Number.isInteger(Number(item.typeId)) && Number(item.typeId) > 0 && Number(item.quantity) > 0);
  const next = mergeShoppingList(loadShoppingList(), valid);
  saveShoppingList(next);
  window.dispatchEvent(new CustomEvent(SHOPPING_LIST_UPDATED_EVENT, { detail: { items: next, message } }));
  return { items: next, addedLines: new Set(valid.map((item) => Number(item.typeId))).size, addedUnits: valid.reduce((sum, item) => sum + Math.max(1, Math.floor(Number(item.quantity) || 1)), 0) };
}
