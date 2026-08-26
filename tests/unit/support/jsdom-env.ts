import { JSDOM } from "jsdom";

// Must be imported before react-dom: react-dom decides at module-evaluation time
// whether a DOM is available, and input events fall back to a broken polyfill path
// when the globals are installed afterwards.
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
