import test from "node:test";
import assert from "node:assert/strict";
import {
    buildTaskTitleHighlightSegments,
    getParserKeywordCompletion,
    parseTaskDescription,
    splitTitleLinks,
} from "../../src/lib/task-title-parser.ts";
import {
    hasParserDrivenDeadlineHint,
    parseTaskTitleAndSubtasks,
    resolveTaskDeadline,
} from "../../src/lib/parser_keyword_resolver.ts";

test("-d(...) extracts inline verification context while preserving later metadata", () => {
    const input = "cut nail -d(show image of clean nails) @tmrw";

    assert.deepEqual(parseTaskDescription(input), {
        taskInput: "cut nail @tmrw",
        description: "show image of clean nails",
    });
    assert.deepEqual(parseTaskTitleAndSubtasks(input), {
        title: "cut nail",
        subtasks: [],
    });
    assert.equal(hasParserDrivenDeadlineHint(parseTaskDescription(input).taskInput), true);

    const now = new Date(2026, 6, 26, 10, 0, 0, 0);
    const resolution = resolveTaskDeadline(parseTaskDescription(input).taskInput, now, 60);
    assert.equal(resolution.error, null);
    assert.equal(resolution.deadline.getFullYear(), 2026);
    assert.equal(resolution.deadline.getMonth(), 6);
    assert.equal(resolution.deadline.getDate(), 27);
    assert.equal(resolution.deadline.getHours(), 23);
    assert.equal(resolution.deadline.getMinutes(), 0);
});

test("-d(...) supports subtasks and balanced parentheses in context", () => {
    const input =
        "morning skincare / face wash / moisturizer -d(show items (including moisturizer)) @tmrw";

    assert.deepEqual(parseTaskDescription(input), {
        taskInput: "morning skincare / face wash / moisturizer @tmrw",
        description: "show items (including moisturizer)",
    });
    assert.deepEqual(parseTaskTitleAndSubtasks(input), {
        title: "morning skincare",
        subtasks: ["face wash", "moisturizer"],
    });
});

test("removed description aliases are no longer parsed", () => {
    assert.deepEqual(parseTaskDescription("read book -des show the final page"), {
        taskInput: "read book -des show the final page",
        description: null,
    });
    assert.deepEqual(parseTaskDescription("read book -desc quote your notes"), {
        taskInput: "read book -desc quote your notes",
        description: null,
    });
});

test("-d( autocompletes and only command wrappers are highlighted", () => {
    const completion = getParserKeywordCompletion("cut nail -d", "cut nail -d".length, []);
    const input = "cut nail -d(show image tomorrow @9) @tmrw";
    const segments = buildTaskTitleHighlightSegments(input);

    assert.equal(completion?.insertText, "-d(");
    assert.equal(
        segments
            .filter((segment) => segment.className === "text-orange-400")
            .map((segment) => segment.text)
            .join(""),
        "-d()@tmrw"
    );
    assert.equal(
        getParserKeywordCompletion("cut nail -d(show -proo", "cut nail -d(show -proo".length, []),
        null
    );
});

test("links in the title are not split into subtasks", () => {
    assert.deepEqual(
        parseTaskTitleAndSubtasks("expression of interest form, https://docs.google.com/forms/d/e/1FAIpQLSd/viewform"),
        {
            title: "expression of interest form, https://docs.google.com/forms/d/e/1FAIpQLSd/viewform",
            subtasks: [],
        }
    );
    assert.deepEqual(parseTaskTitleAndSubtasks("read www.example.com/a/b / take notes"), {
        title: "read www.example.com/a/b",
        subtasks: ["take notes"],
    });
});

test("numbers inside links are not read as deadline dates", () => {
    const input = "read https://x.com/12/5/post";
    assert.equal(hasParserDrivenDeadlineHint(input), false);
    const now = new Date(2026, 9, 23, 10, 0, 0, 0);
    const resolution = resolveTaskDeadline(input, now, 60);
    assert.equal(resolution.error, null);
    assert.equal(resolution.deadline.getDate(), 23);
});

test("titles split into text and full-URL link segments", () => {
    const url = "https://docs.google.com/forms/d/e/1FAIpQLSd/viewform";
    assert.deepEqual(splitTitleLinks(`expression of interest form ${url}`), [
        { type: "text", value: "expression of interest form " },
        { type: "link", value: url, href: url },
    ]);
    assert.deepEqual(splitTitleLinks("see www.example.com/a."), [
        { type: "text", value: "see " },
        { type: "link", value: "www.example.com/a", href: "https://www.example.com/a" },
        { type: "text", value: "." },
    ]);
    assert.deepEqual(splitTitleLinks("no links here"), [{ type: "text", value: "no links here" }]);
});
