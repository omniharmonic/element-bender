import { test, expect, type Page } from "@playwright/test";
const state = (page: Page) =>
  page.evaluate(() => (window as any).elementBender.snapshot());
async function open(page: Page, element = "air") {
  await page.goto(`/#${element}`);
  await expect(page.locator("#loading")).toHaveClass("done");
  await page.locator("#settings-button").click();
  await page.locator("#quality").selectOption("low");
  await page.locator("#settings-button").click();
}

test("all four live worlds open without camera requests or graphics errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || m.text().includes("GL_INVALID"))
      errors.push(m.text());
  });
  await page.addInitScript(() => {
    (window as any).mediaRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      (window as any).mediaRequests++;
      throw new Error("Camera should be optional");
    };
  });
  await open(page);
  for (const element of ["air", "water", "earth", "fire"]) {
    await page.locator(`button[data-element=${element}]`).click();
    await expect(
      page.locator(`button[data-element=${element}]`),
    ).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(450);
    expect((await state(page)).element).toBe(element);
  }
  expect(await page.evaluate(() => (window as any).mediaRequests)).toBe(0);
  expect(errors).toEqual([]);
});

test("gather lifts liquid through pointer input; release restores gravity", async ({
  page,
}) => {
  await open(page, "water");
  await page.waitForTimeout(1400);
  const before = (await state(page)).waterMeanHeight;
  await page.locator("[data-action=gather]").click();
  await page.mouse.move(640, 460);
  await page.mouse.down();
  await page.waitForTimeout(350);
  await page.mouse.move(680, 320, { steps: 45 });
  await expect
    .poll(async () => (await state(page)).waterMeanHeight)
    .toBeGreaterThan(before + 0.35);
  const lifted = (await state(page)).waterMeanHeight;
  expect((await state(page)).hands).toBe(1);
  await page.mouse.up();
  await expect
    .poll(async () => (await state(page)).waterMeanHeight)
    .toBeLessThan(lifted - 0.2);
});

test("sculpting reroutes a watershed and survives switching elements", async ({
  page,
}) => {
  await open(page, "earth");
  const initial = await state(page);
  await page.locator("[data-action=lift]").click();
  await page.mouse.move(680, 390);
  await page.mouse.down();
  await page.waitForTimeout(1300);
  await page.mouse.up();
  const changed = await state(page);
  expect(changed.terrainChecksum).toBeGreaterThan(initial.terrainChecksum + 1);
  expect(changed.terrainRevision).toBeGreaterThan(initial.terrainRevision);
  await page.locator("button[data-element=air]").click();
  await page.locator("button[data-element=earth]").click();
  expect((await state(page)).terrainChecksum).toBeCloseTo(
    changed.terrainChecksum,
    3,
  );
  await page.locator("#reset-button").click();
  expect((await state(page)).terrainChecksum).toBeCloseTo(
    initial.terrainChecksum,
    3,
  );
});

test("camera denial is recoverable; real tracking runtime starts and stops on a synthetic video", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Denied", "NotAllowedError");
    };
  });
  await open(page);
  await page.locator("#camera-button").click();
  await expect(page.locator("#toast")).toContainText("permission declined");
  expect((await state(page)).camera).toBe(false);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext("2d")!;
      const draw = () => {
        ctx.fillStyle = "#657687";
        ctx.fillRect(0, 0, 640, 480);
        ctx.fillStyle = "white";
        ctx.fillRect((performance.now() / 8) % 600, 200, 20, 20);
      };
      draw();
      (window as any).fakeInterval = setInterval(draw, 50);
      const stream = canvas.captureStream(20);
      (window as any).fakeStream = stream;
      return stream;
    };
  });
  await page.locator("#camera-button").click();
  await expect(page.locator("#camera-button")).toHaveClass(
    "camera-button active",
  );
  await expect(page.locator("#camera-preview")).toBeVisible();
  expect((await state(page)).camera).toBe(true);
  await page.waitForTimeout(300);
  await page.locator("#stop-camera").click();
  await expect(page.locator("#camera-preview")).toBeHidden();
  expect(
    await page.evaluate(() =>
      (window as any).fakeStream
        .getTracks()
        .every((t: MediaStreamTrack) => t.readyState === "ended"),
    ),
  ).toBe(true);
  await page.evaluate(() => clearInterval((window as any).fakeInterval));
});

test("keyboard pause, help, quality controls and PNG export work", async ({
  page,
}) => {
  await open(page);
  await page.locator("#canvas").focus();
  await page.keyboard.press("Space");
  const paused = await state(page);
  expect(paused.paused).toBe(true);
  await page.waitForTimeout(200);
  expect((await state(page)).time).toBe(paused.time);
  await page.keyboard.press("Space");
  await expect
    .poll(async () => (await state(page)).time)
    .toBeGreaterThan(paused.time);
  await page.keyboard.press("4");
  expect((await state(page)).element).toBe("fire");
  await page.keyboard.press("g");
  expect((await state(page)).action).toBe("gather");
  await page.locator("#help-button").click();
  await expect(page.locator("#help-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#help-dialog")).toBeHidden();
  const download = page.waitForEvent("download");
  await page.locator("#capture-button").click();
  expect((await download).suggestedFilename()).toMatch(
    /^element-bender-fire-.*\.png$/,
  );
});

test("small touch viewport keeps every element and action reachable", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await open(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  expect(overflow).toBe(false);
  for (const element of ["air", "water", "earth", "fire"]) {
    const button = page.locator(`button[data-element=${element}]`);
    await button.tap();
    const box = await button.boundingBox();
    expect(box!.y + box!.height).toBeLessThan(844);
    expect((await state(page)).element).toBe(element);
  }
  for (const action of ["flow", "gather", "push", "swirl", "lift", "calm"]) {
    await page.locator(`[data-action=${action}]`).tap();
    expect((await state(page)).action).toBe(action);
  }
  await page.screenshot({ path: "test-results/mobile-experience.png" });
  await context.close();
});
