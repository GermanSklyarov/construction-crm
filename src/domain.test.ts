import { expect, it } from "vitest";
import { actions } from "./domain";
it("скрывает действия после переназначения", () =>
  expect(actions("executor", "in_progress", false)).toEqual([]));
it("показывает оба решения постановщика при проверке", () =>
  expect(actions("manager", "in_review", false)).toEqual([
    "accepted",
    "needs_revision",
  ]));
it("позволяет исполнителю возобновить доработку", () =>
  expect(actions("executor", "needs_revision", true)).toEqual(["in_progress"]));
