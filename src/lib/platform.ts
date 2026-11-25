
export type Platform = 'web' | 'ios' | 'android';

export function getPlatform(): Platform {
    if (typeof window === 'undefined') return 'web';

    const userAgent = window.navigator.userAgent.toLowerCase();

    if (/iphone|ipad|ipod/.test(userAgent)) {
        return 'ios';
    }

    if (/android/.test(userAgent)) {
        return 'android';
    }

    return 'web';
}

export const isNative = (): boolean => {
    return !!(window.Capacitor && window.Capacitor.isNative);
};

export const isIOS = () => getPlatform() === 'ios';
export const isAndroid = () => getPlatform() === 'android';
export const isMobile = () => isIOS() || isAndroid();

export const getSafeAreaInsets = () => {
    return {
        top: 'env(safe-area-inset-top)',
        right: 'env(safe-area-inset-right)',
        bottom: 'env(safe-area-inset-bottom)',
        left: 'env(safe-area-inset-left)',
    };
};

export const openExternalLink = (url: string) => {
    if (typeof window === 'undefined') return;

    if (window.Capacitor && window.Capacitor.isNative) {
        window.open(url, '_blank');
    } else {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
};
