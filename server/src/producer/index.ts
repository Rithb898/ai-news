import { paths } from "../shared/paths.ts";
import { runProducerLoop } from "./loop.ts";

console.log("producer up");
console.log(`data dir: ${paths.data}`);

await runProducerLoop();
