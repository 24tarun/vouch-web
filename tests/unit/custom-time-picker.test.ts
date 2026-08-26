import "./support/jsdom-env";

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { CustomTimePicker, parseTimeInput, shiftClockTime } from "../../src/components/ui/custom-time-picker";

test.afterEach(() => {
    cleanup();
});

test("minute shortcuts cross hour boundaries", () => {
    assert.equal(shiftClockTime(10, 5, -10), "09:55");
    assert.equal(shiftClockTime(10, 59, 1), "11:00");
});

test("minute shortcuts wrap across midnight", () => {
    assert.equal(shiftClockTime(0, 0, -1), "23:59");
    assert.equal(shiftClockTime(23, 55, 10), "00:05");
});

test("typed time input is normalised", () => {
    assert.equal(parseTimeInput("9"), "09:00");
    assert.equal(parseTimeInput("93"), "09:30");
    assert.equal(parseTimeInput("18"), "18:00");
    assert.equal(parseTimeInput("930"), "09:30");
    assert.equal(parseTimeInput("18:45"), "18:45");
    assert.equal(parseTimeInput("99:99"), "23:59");
    assert.equal(parseTimeInput(""), "");
});

test("wheel input over the time field changes time and consumes page scroll", () => {
    let nextValue = "";
    const view = render(React.createElement(CustomTimePicker, {
        value: "23:59",
        onChange: (value: string) => {
            nextValue = value;
        },
    }));

    const timeInput = view.getByLabelText("Time");
    const eventWasNotCancelled = fireEvent.wheel(timeInput, { deltaY: 100, deltaMode: 0 });

    assert.equal(nextValue, "00:00");
    assert.equal(eventWasNotCancelled, false);
});

test("typing a loose time and pressing enter commits a normalised value", () => {
    let nextValue = "";
    const view = render(React.createElement(CustomTimePicker, {
        value: "23:00",
        onChange: (value: string) => {
            nextValue = value;
        },
    }));

    const timeInput = view.getByLabelText("Time");
    fireEvent.change(timeInput, { target: { value: "845" } });
    fireEvent.keyDown(timeInput, { key: "Enter" });

    assert.equal(nextValue, "08:45");
});

test("arrow keys step the time without opening a menu", () => {
    let nextValue = "";
    const view = render(React.createElement(CustomTimePicker, {
        value: "09:00",
        onChange: (value: string) => {
            nextValue = value;
        },
    }));

    const timeInput = view.getByLabelText("Time");
    fireEvent.keyDown(timeInput, { key: "ArrowUp" });
    assert.equal(nextValue, "09:15");

    fireEvent.keyDown(timeInput, { key: "ArrowDown", shiftKey: true });
    assert.equal(nextValue, "08:00");
});
