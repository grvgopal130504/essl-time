const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function stamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 23);
}

function write(color, tag, args) {
  console.log(`${COLORS.dim}${stamp()}${COLORS.reset} ${color}${tag}${COLORS.reset}`, ...args);
}

export const log = {
  info: (...a) => write(COLORS.cyan, "[INFO ]", a),
  ok: (...a) => write(COLORS.green, "[ OK  ]", a),
  warn: (...a) => write(COLORS.yellow, "[WARN ]", a),
  error: (...a) => write(COLORS.red, "[ERROR]", a),
  device: (...a) => write(COLORS.magenta, "[DEVICE]", a),
  punch: (...a) => write(COLORS.green, "[PUNCH]", a),
  raw: (...a) => write(COLORS.blue, "[RAW  ]", a),
};

export function banner(lines) {
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  console.log("\n" + "=".repeat(width));
  lines.forEach((l) => console.log("  " + l));
  console.log("=".repeat(width) + "\n");
}
