/* Small shared helpers. */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Generates a cute app name.
 */
export function generateCuteAppName(): string {
  const adjectives = [
    "amber",
    "aurora",
    "brisk",
    "candid",
    "cobalt",
    "crimson",
    "dawn",
    "emerald",
    "fern",
    "golden",
    "harbor",
    "ivory",
    "jasper",
    "keen",
    "lagoon",
    "lunar",
    "maple",
    "noble",
    "opal",
    "pearl",
    "quartz",
    "rustic",
    "sage",
    "topaz",
    "umber",
    "verdant",
    "willow",
    "zenith",
  ];

  const animals = [
    "heron",
    "ibex",
    "jay",
    "koi",
    "lynx",
    "moth",
    "newt",
    "orca",
    "pika",
    "quail",
    "ram",
    "stag",
    "tapir",
    "urial",
    "vireo",
    "wren",
    "yak",
    "finch",
    "crane",
    "dove",
    "elk",
    "fawn",
    "gull",
    "hare",
    "impala",
    "kestrel",
    "lark",
    "marten",
    "nuthatch",
    "osprey",
    "perch",
    "robin",
    "sparrow",
    "thrush",
    "vole",
    "whale",
  ];

  const verbs = [
    "drift",
    "gather",
    "wander",
    "meander",
    "ripple",
    "cascade",
    "wander",
    "linger",
    "glimmer",
    "amble",
    "roam",
    "saunter",
    "glide",
    "stride",
    "stroll",
    "traverse",
    "venture",
    "circle",
    "trace",
    "sketch",
    "paint",
    "carve",
    "weave",
    "bloom",
    "spark",
    "shine",
    "drift",
    "float",
    "ascend",
    "descend",
  ];

  const randomAdjective =
    adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomAnimal = animals[Math.floor(Math.random() * animals.length)];
  const randomVerb = verbs[Math.floor(Math.random() * verbs.length)];
  return `${randomAdjective}-${randomAnimal}-${randomVerb}`;
}
