/**
 * The "Limitations and uncertainty" rows for a result, from the registry entry
 * of the model that ran (mace-api/contract.json via findModel()). Nothing here
 * names a model, element list or level of theory itself: a row that is true of
 * MACE-OFF is not printed under a materials result, and advice only mentions
 * options the registry actually offers.
 */

import { MODELS, findModel } from "@/lib/contract";

export interface Limitation {
  title: string;
  text: string;
}

export function limitationsFor(modelType: string | undefined): Limitation[] {
  const model = findModel(modelType);
  const rows: Limitation[] = [
    {
      title: "ML potential, not QM",
      text:
        "MACE is a machine-learned surrogate for DFT, not a first-principles calculation. " +
        "Accuracy depends on the training data distribution.",
    },
    {
      title: "Out-of-distribution risk",
      text:
        "Structures or chemistries far from the training set (exotic bonding, extreme pressures, " +
        "charged species) may produce unreliable results with no built-in warning.",
    },
  ];

  if (!model) {
    rows.push({
      title: "No uncertainty estimates",
      text: "These models do not provide prediction confidence intervals. Validate important results against a reference calculation.",
    });
    return rows;
  }

  if (model.domain === "materials") {
    const others = MODELS.filter((m) => m.domain === "materials" && m.id !== model.id).map((m) => m.label);
    rows.push({
      title: "No uncertainty estimates",
      text:
        "These models do not provide prediction confidence intervals." +
        (others.length > 0
          ? ` Comparing with ${others.join(" or ")} shows how much the answer depends on the model, but disagreement is a warning sign, not a confidence interval.`
          : "") +
        " Validate important results against a reference calculation.",
    });
    rows.push({
      title: `${model.label} scope`,
      text:
        `Trained on ${model.levelOfTheory} data for materials (${model.elementCount} elements). ` +
        "It inherits that functional's systematic errors, so absolute energies are not experimental values.",
    });
  } else if (model.domain === "organic") {
    rows.push({
      title: "No uncertainty estimates",
      text:
        "These models do not provide prediction confidence intervals. " +
        "Validate important results against a reference calculation on your system.",
    });
    rows.push({
      title: `${model.label} scope`,
      text:
        `Trained on neutral, closed-shell organic molecules only (${(model.elements ?? []).join(", ")}). ` +
        "Not suitable for metals, radicals, ions, or extended solid-state systems.",
    });
  } else {
    rows.push({
      title: "No uncertainty estimates",
      text: "A custom checkpoint carries no confidence intervals. Validate it against your own reference data.",
    });
    rows.push({
      title: "Custom checkpoint",
      text:
        "Its training data, level of theory and energy reference are unknown to SimpleAtom, so none of a " +
        "foundation model's scope statements apply, and its absolute energies cannot be compared with theirs.",
    });
  }
  return rows;
}
