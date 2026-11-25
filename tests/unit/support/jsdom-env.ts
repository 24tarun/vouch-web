import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });

const globalAny = globalThis as typeof globalThis & {
    window: Window & typeof globalThis;
    document: Document;
    navigator: Navigator;
    HTMLElement: typeof HTMLElement;
    HTMLInputElement: typeof HTMLInputElement;
    Node: typeof Node;
    IS_REACT_ACT_ENVIRONMENT: boolean;
};

globalAny.window = dom.window as unknown as Window & typeof globalThis;
globalAny.document = dom.window.document;
Object.defineProperty(globalAny, "navigator", { value: dom.window.navigator, configurable: true });
globalAny.HTMLElement = dom.window.HTMLElement;
globalAny.HTMLInputElement = dom.window.HTMLInputElement;
globalAny.Node = dom.window.Node;
globalAny.IS_REACT_ACT_ENVIRONMENT = true;
