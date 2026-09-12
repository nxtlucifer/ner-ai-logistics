import { describe, expect, it } from 'vitest'

import { classifyIntent } from './intents'

describe('classifyIntent', () => {
  it('maps typed questions to intents in the three reason-code languages and romanised Hindi', () => {
    expect(classifyIntent('Is it raining ahead?')).toBe('WEATHER')
    expect(classifyIntent('aage mausam kaisa hai')).toBe('WEATHER')
    expect(classifyIntent('कितनी चढ़ाई है')).toBe('TERRAIN')
    expect(classifyIntent('ভূমিস্খলনৰ আশংকা আছেনে')).toBe('LANDSLIDE')
    expect(classifyIntent('Where is my next stop')).toBe('NEXT_STOP')
    expect(classifyIntent('do i need a break')).toBe('BREAK')
    expect(classifyIntent('am I online?')).toBe('CONNECTIVITY')
    expect(classifyIntent('how do I say unloading in Assamese')).toBe('TRANSLATE')
    expect(classifyIntent('my tyre is punctured')).toBe('VEHICLE_ISSUE')
    expect(classifyIntent('Is this route safe?')).toBe('ROUTE_RISK')
  })

  it('puts emergency before everything and refuses to guess', () => {
    expect(classifyIntent('truck accident, need help')).toBe('EMERGENCY')
    expect(classifyIntent('restaurant nearby?')).toBe('UNKNOWN')
    expect(classifyIntent('')).toBe('UNKNOWN')
    expect(classifyIntent('what is the meaning of life')).toBe('UNKNOWN')
  })
})
