/** Case-insensitive id comparator, so rows don't jump while states change */
export const compareIds = (a: { id: string }, b: { id: string }): number => {
    const x = a.id.toLowerCase(), y = b.id.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
};
