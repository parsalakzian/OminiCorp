const recommendations = [
  ['software', 'creative'],
  ['security', 'hardware'],
  ['creative', 'software'],
  ['architecture', 'security'],
];

export function recommendServices(goal) {
  return Number.isInteger(goal) ? [...(recommendations[goal] ?? [])] : [];
}

export function moveSlide(current, direction, count) {
  if (!Number.isInteger(count) || count < 1) return 0;
  return ((current + direction) % count + count) % count;
}
