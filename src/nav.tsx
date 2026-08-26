import { createContext, useContext } from 'react';

// Lets deeply-nested content (a #channel link inside a rendered message)
// ask the shell to open a channel, without threading a callback through
// every Markdown call site. Null when there's no shell to navigate — the
// renderer then falls back to plain text rather than a dead button.
export const OpenChannelCtx = createContext<((channelId: string) => void) | null>(null);

export const useOpenChannel = () => useContext(OpenChannelCtx);

// #field-guide, #FieldGuide and #field guide should all reach the same
// channel, so both sides collapse to letters and digits before comparing.
export const channelSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
