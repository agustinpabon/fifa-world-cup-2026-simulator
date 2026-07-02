import { parentPort } from "node:worker_threads";

import { type ModelConfig, type TeamMetrics } from "./elo.js";
import {
  runSimulations,
  type PlayedMatch,
  type SimResult,
} from "./simulation.js";

export type SimulationWorkerSnapshot = {
  version: number;
  seed: string;
  ratings: Record<string, number>;
  teamMetrics: Record<string, TeamMetrics>;
  playedMatches: PlayedMatch[];
  modelConfig: ModelConfig;
};

export type SimulationWorkerRequest = {
  type: "run-simulations";
  requestId: string;
  snapshot: SimulationWorkerSnapshot;
  simulationsRun: number;
};

export type SimulationWorkerErrorPayload = {
  name: string;
  message: string;
  stack?: string;
};

export type SimulationWorkerResponse =
  | {
      type: "simulation-complete";
      requestId: string;
      result: SimResult;
    }
  | {
      type: "simulation-error";
      requestId: string;
      error: SimulationWorkerErrorPayload;
    };

function serializeError(error: unknown): SimulationWorkerErrorPayload {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }

  return {
    name: "Error",
    message: String(error),
  };
}

function isSimulationWorkerRequest(
  message: unknown,
): message is SimulationWorkerRequest {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const candidate = message as Partial<SimulationWorkerRequest>;
  const simulationsRun = candidate.simulationsRun;
  return (
    candidate.type === "run-simulations" &&
    typeof candidate.requestId === "string" &&
    typeof candidate.snapshot === "object" &&
    candidate.snapshot !== null &&
    typeof simulationsRun === "number" &&
    Number.isInteger(simulationsRun) &&
    simulationsRun > 0
  );
}

function getParentPort(): NonNullable<typeof parentPort> {
  if (!parentPort) {
    throw new Error("simulation.worker must be run as a worker thread");
  }

  return parentPort;
}

const simulationWorkerPort = getParentPort();

function postResponse(response: SimulationWorkerResponse): void {
  simulationWorkerPort.postMessage(response);
}

simulationWorkerPort.once("message", (message: unknown) => {
  if (!isSimulationWorkerRequest(message)) {
    postResponse({
      type: "simulation-error",
      requestId: "unknown",
      error: {
        name: "TypeError",
        message: "Invalid simulation worker request",
      },
    });
    simulationWorkerPort.close();
    return;
  }

  try {
    const { snapshot } = message;
    const result = runSimulations(
      snapshot.ratings,
      snapshot.playedMatches,
      snapshot.teamMetrics,
      {
        seed: snapshot.seed,
        simulationsRun: message.simulationsRun,
        modelConfig: snapshot.modelConfig,
      },
    );

    postResponse({
      type: "simulation-complete",
      requestId: message.requestId,
      result,
    });
  } catch (error) {
    postResponse({
      type: "simulation-error",
      requestId: message.requestId,
      error: serializeError(error),
    });
  } finally {
    simulationWorkerPort.close();
  }
});
