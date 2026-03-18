// Minimal OBJLoader mock for vitest
export class OBJLoader {
  load() {}
  parse() { return { traverse: () => {} }; }
}
