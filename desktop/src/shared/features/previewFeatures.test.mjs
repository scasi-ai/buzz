import assert from "node:assert/strict";
import { describe, it } from "node:test";

import featuresManifest from "../../../../preview-features.json" with {
  type: "json",
};

describe("preview feature defaults", () => {
  it("enables every declared preview feature by default", () => {
    const disabledByDefault = featuresManifest.features
      .filter((feature) => feature.defaultEnabled !== true)
      .map((feature) => feature.id);

    assert.deepEqual(disabledByDefault, []);
  });
});
