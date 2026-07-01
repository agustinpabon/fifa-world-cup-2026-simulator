import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

type OracleStatusBody = {
  data?: {
    state?: string;
    ready?: boolean;
    recalculating?: boolean;
  };
  meta?: {
    readiness?: {
      state?: string;
      ready?: boolean;
    };
  };
};

const READY_TIMEOUT_MS = 90_000;

async function getOracleStatus(request: APIRequestContext): Promise<{
  state: string;
  ready: boolean;
  recalculating: boolean;
}> {
  const response = await request.get("/api/oracle/status");
  if (!response.ok()) {
    return { state: `http-${response.status()}`, ready: false, recalculating: true };
  }

  const body = (await response.json()) as OracleStatusBody;
  const state = body.meta?.readiness?.state ?? body.data?.state ?? "unknown";

  return {
    state,
    ready: body.meta?.readiness?.ready ?? body.data?.ready ?? false,
    recalculating: body.data?.recalculating ?? false,
  };
}

async function waitForOracleReady(request: APIRequestContext): Promise<void> {
  await expect
    .poll(
      async () => {
        const status = await getOracleStatus(request);
        return status.ready && status.state === "ready" ? "ready" : status.state;
      },
      {
        message: "oracle API should finish loading ratings and simulation",
        timeout: READY_TIMEOUT_MS,
        intervals: [500, 1_000, 2_000],
      }
    )
    .toBe("ready");
}

async function waitForOracleReadyAndIdle(request: APIRequestContext): Promise<void> {
  await expect
    .poll(
      async () => {
        const status = await getOracleStatus(request);
        return status.ready && status.state === "ready" && !status.recalculating
          ? "ready-idle"
          : `${status.state}-${status.recalculating ? "busy" : "idle"}`;
      },
      {
        message: "oracle API should be ready with no recalculation in progress",
        timeout: READY_TIMEOUT_MS,
        intervals: [500, 1_000, 2_000],
      }
    )
    .toBe("ready-idle");
}

async function clearManualOverrides(request: APIRequestContext): Promise<void> {
  const response = await request.post("/api/oracle/live-matches/clear");
  expect(response.ok()).toBeTruthy();
}

async function gotoDashboard(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /World Cup Oracle/i })).toBeVisible();
}

function liveMatchResponse(page: Page, method: "POST" | "DELETE") {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/oracle/live-match" &&
      response.request().method() === method &&
      response.status() === 200
    );
  });
}

test.describe("World Cup Oracle smoke", () => {
  test.beforeEach(async ({ request }) => {
    await waitForOracleReady(request);
    await clearManualOverrides(request);
  });

  test.afterEach(async ({ request }) => {
    await clearManualOverrides(request).catch(() => undefined);
  });

  test("shows basic leaderboard loading and error states", async ({ page }) => {
    await page.route("**/api/oracle/simulation**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });

    await gotoDashboard(page);
    await expect(page.getByTestId("leaderboard-loading")).toBeVisible();
    await expect(page.getByTestId("leaderboard-table")).toBeVisible({ timeout: 30_000 });

    await page.unroute("**/api/oracle/simulation**");
    await page.route("**/api/oracle/simulation**", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "test_failure",
            message: "Simulated E2E failure",
          },
        }),
      });
    });

    await page.reload();
    await expect(page.getByTestId("leaderboard-error")).toContainText(
      "Unable to load tournament predictions.",
      { timeout: 20_000 }
    );
  });

  test("loads dashboard, filters teams, opens groups, predicts a match, and restores an override", async ({
    page,
    request,
  }) => {
    await waitForOracleReadyAndIdle(request);
    await gotoDashboard(page);

    await expect(page.getByTestId("oracle-status")).toContainText("Oracle Active");
    await expect(page.getByTestId("leaderboard-table")).toBeVisible();
    await expect(page.getByTestId("leaderboard-row")).toHaveCount(48);

    await page.getByTestId("leaderboard-search").fill("Argentina");
    await expect(page.getByTestId("leaderboard-row")).toHaveCount(1);
    await expect(page.getByTestId("leaderboard-row").first()).toContainText("Argentina");
    await page.getByTestId("leaderboard-row").first().click();
    await expect(page.getByTestId("leaderboard-details")).toContainText("Goal Multipliers");

    await page.getByRole("tab", { name: "Groups" }).click();
    await expect(page.getByTestId("group-standings")).toBeVisible();
    await expect(page.getByTestId("group-card")).toHaveCount(12);

    await page.getByRole("tab", { name: "Predictor" }).click();
    await expect(page.getByTestId("predictor-team-count")).toContainText("48 teams available");
    await page.getByTestId("predictor-home-team").fill("France");
    await page.getByTestId("predictor-home-team-option").filter({ hasText: "France" }).click();
    await page.getByTestId("predictor-away-team").fill("Argentina");
    await page.getByTestId("predictor-away-team-option").filter({ hasText: "Argentina" }).click();
    await page.getByTestId("predictor-venue-team-1-home").click();
    await expect(page.getByTestId("predictor-venue-team-1-home")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("predict-match-button")).toBeEnabled();
    await page.getByTestId("predict-match-button").click();
    await expect(page.getByTestId("predictor-loading")).toBeVisible();
    await expect(page.getByTestId("prediction-results")).toContainText("Most Likely Score", {
      timeout: 15_000,
    });

    await page.getByRole("tab", { name: "Match Center" }).click();
    await expect(page.getByTestId("match-center")).toBeVisible();
    await page.getByTestId("match-stage-group").click();

    const mexicoSouthAfrica = page
      .getByTestId("match-card")
      .filter({ hasText: "Mexico" })
      .filter({ hasText: "South Africa" })
      .first();

    await expect(mexicoSouthAfrica).toBeVisible();
    await mexicoSouthAfrica.getByTestId("home-score-input").fill("2");
    await mexicoSouthAfrica.getByTestId("away-score-input").fill("1");

    await Promise.all([
      liveMatchResponse(page, "POST"),
      mexicoSouthAfrica.getByRole("button", { name: "Save" }).click(),
    ]);

    const savedMatch = page
      .getByTestId("match-card")
      .filter({ hasText: "Mexico" })
      .filter({ hasText: "South Africa" })
      .first();

    await expect(savedMatch).toContainText("Manual Override");
    await expect(page.getByText("Manual overrides active")).toBeVisible();
    await page.getByTestId("match-stage-results").click();
    await expect(page.getByTestId("match-results-summary")).toContainText("1 result");
    await expect(page.getByTestId("match-card").filter({ hasText: "Mexico" }).filter({ hasText: "South Africa" })).toContainText("Manual Override");

    await Promise.all([
      liveMatchResponse(page, "DELETE"),
      savedMatch.getByRole("button", { name: "Restore" }).click(),
    ]);

    await expect(page.getByTestId("match-results-summary")).toContainText("0 results");
    await page.getByTestId("match-stage-group").click();

    const restoredMatch = page
      .getByTestId("match-card")
      .filter({ hasText: "Mexico" })
      .filter({ hasText: "South Africa" })
      .first();

    await expect(restoredMatch).toContainText("Unplayed / Scheduled");
    await expect(restoredMatch).not.toContainText("Manual Override");
  });
});
