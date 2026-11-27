import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConfigError, inScope, parseConfig } from "../src/config";

const example = JSON.parse(readFileSync(new URL("../../../config/fleet.example.json", import.meta.url), "utf8"));

describe("parseConfig", () => {
  it("accepts the example config shipped with the repository", () => {
    expect(parseConfig(example).owners).toEqual(["example-user", "example-org"]);
  });

  it("reports every problem at once", () => {
    const bad = structuredClone(example);
    bad.owners = [];
    bad.scheduler.jobs[0].at = "25:00";
    bad.scheduler.jobs[1].name = bad.scheduler.jobs[0].name;
    bad.scheduler.jobs[2].days = ["monday"];
    bad.governance.labels[0].color = "red";
    const err = (() => {
      try {
        parseConfig(bad);
      } catch (e) {
        return e as ConfigError;
      }
      throw new Error("expected a ConfigError");
    })();
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.problems).toHaveLength(5);
    expect(err.problems.join("\n")).toMatch(/HH:MM/);
    expect(err.problems.join("\n")).toMatch(/used twice/);
  });

  it("refuses something that is not an object", () => {
    expect(() => parseConfig([])).toThrow(ConfigError);
  });
});

describe("inScope", () => {
  const config = parseConfig(example);
  it("includes managed owners and leaves out excluded repositories, ignoring case", () => {
    expect(inScope(config, "Example-User/site")).toBe(true);
    expect(inScope(config, "example-user/archive-only")).toBe(false);
    expect(inScope(config, "stranger/site")).toBe(false);
  });
});
