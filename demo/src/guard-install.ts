import { installNetworkGuard } from './guard'

/**
 * Imported FIRST by main.tsx. ES modules run in import order, so this makes the network guard active before any other module
 * (the app's screens, libraries) has even been evaluated.
 */
installNetworkGuard()
