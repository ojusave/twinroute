import { fileURLToPath } from 'node:url';

export const uiDirectory = fileURLToPath(new URL('../public/', import.meta.url));
