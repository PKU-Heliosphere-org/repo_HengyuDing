import { expect, it } from "vitest";
import { elementsFromState } from "../src/stateVector";
import fixture from "./fixtures/state-vectors.json";
import type { Vec3 } from "../src/types";

it.each(fixture.cases)(
  "derives elements for elliptical, hyperbolic, circular and retrograde states: $elements",
  ({ elements, position, velocity }) => {
    const result = elementsFromState(
      position as Vec3,
      velocity as Vec3,
      fixture.mu,
    )!;
    expect(result).not.toBeNull();
    expect(result.a).toBeCloseTo(elements.a, 7);
    expect(result.e).toBeCloseTo(elements.e, 12);
    expect(result.i).toBeCloseTo(elements.i, 8);
    if (elements.e > 0 && elements.i > 0 && elements.i < 180) {
      expect(result.raan).toBeCloseTo(elements.raan, 8);
      expect(result.arg_periapsis).toBeCloseTo(elements.arg_periapsis, 8);
      expect(result.true_anomaly).toBeCloseTo(
        (elements.true_anomaly + 360) % 360,
        8,
      );
    }
    // Equivalent conventions for singular circular/equatorial angles must reproduce the state.
    const [inc, node, arg, nu] = [
      result.i,
      result.raan,
      result.arg_periapsis,
      result.true_anomaly,
    ].map((x) => (x * Math.PI) / 180);
    const [cO, sO, ci, si, cw, sw] = [
      Math.cos(node),
      Math.sin(node),
      Math.cos(inc),
      Math.sin(inc),
      Math.cos(arg),
      Math.sin(arg),
    ];
    const p = result.a * (1 - result.e * result.e),
      radius = p / (1 + result.e * Math.cos(nu));
    const rotation = [
      [cO * cw - sO * sw * ci, -cO * sw - sO * cw * ci],
      [sO * cw + cO * sw * ci, -sO * sw + cO * cw * ci],
      [sw * si, cw * si],
    ];
    rotation.forEach(([a, b], j) => {
      expect(radius * (a * Math.cos(nu) + b * Math.sin(nu))).toBeCloseTo(
        position[j],
        7,
      );
      expect(
        Math.sqrt(fixture.mu / p) *
          (-a * Math.sin(nu) + b * (result.e + Math.cos(nu))),
      ).toBeCloseTo(velocity[j], 9);
    });
  },
);

it("keeps singular radial/parabolic vectors valid without inventing editable elements", () => {
  expect(elementsFromState([0, 0, 0], [0, 1, 0], fixture.mu)).toBeNull();
  expect(elementsFromState([7000, 0, 0], [1, 0, 0], fixture.mu)).toBeNull();
  expect(elementsFromState([7000, 0, 0], [0, 0, 0], fixture.mu)).toBeNull();
  expect(
    elementsFromState(
      [7000, 0, 0],
      [0, Math.sqrt((2 * fixture.mu) / 7000), 0],
      fixture.mu,
    ),
  ).toBeNull();
});
