import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'TAS',
        short_name: 'TAS',
        description: 'Task Accountability System',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui', 'browser'],
        orientation: 'portrait',
        background_color: '#0a0a0a',
        theme_color: '#0a0a0a',
        categories: ['productivity', 'utilities'],
        icons: [
            {
                src: '/favicon.ico',
                sizes: 'any',
                type: 'image/x-icon',
            },
            {
                src: '/icon-192.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'maskable',
            },
            {
                src: '/icon-512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'maskable',
            },
        ],
        shortcuts: [
            {
                name: 'Tasks',
                short_name: 'Tasks',
                description: 'Open your task inbox',
                url: '/tasks',
                icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
            },
            {
                name: 'Friends',
                short_name: 'Friends',
                description: 'Review pending vouch requests',
                url: '/friends',
                icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
            },
        ],
    };
}
