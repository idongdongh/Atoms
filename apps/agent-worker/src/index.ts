export function getWorkerIdentity() {
  return {
    service: "agent-worker",
    status: "ready",
  } as const;
}

if (process.env.NODE_ENV !== "test") {
  console.log(JSON.stringify(getWorkerIdentity()));
}
