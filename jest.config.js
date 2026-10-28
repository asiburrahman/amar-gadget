module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  modulePathIgnorePatterns: ["<rootDir>/.next/"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transform: {
    "^.+\\.[tj]sx?$": ["ts-jest", { tsconfig: "tsconfig.json" }],
  },
  // jose publishes ESM; compile its actual implementation for CommonJS Jest.
  transformIgnorePatterns: ["/node_modules/(?!jose/)"],
};
