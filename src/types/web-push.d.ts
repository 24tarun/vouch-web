declare module "web-push" {
    interface WebPushModule {
        setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
        sendNotification(subscription: unknown, payload?: string, options?: unknown): Promise<unknown>;
    }

    const webPush: WebPushModule;
    export default webPush;
}
