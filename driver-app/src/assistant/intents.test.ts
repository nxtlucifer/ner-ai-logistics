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

  it('understands health in all five languages, and red flags before anything else', () => {
    expect(classifyIntent('I am feeling dizziness')).toBe('HEALTH')
    expect(classifyIntent('mujhe chakkar aa raha hai')).toBe('HEALTH')
    expect(classifyIntent('मुझे चक्कर आ रहा है')).toBe('HEALTH')
    expect(classifyIntent('મને ચક્કર આવે છે')).toBe('HEALTH')
    expect(classifyIntent('মোৰ মূৰ ঘূৰাইছে')).toBe('HEALTH')
    expect(classifyIntent('আমার মাথা ঘোরাচ্ছে')).toBe('HEALTH')
    expect(classifyIntent('I have a headache and fever')).toBe('HEALTH')
    expect(classifyIntent('chest pain, help')).toBe('HEALTH_URGENT')
    expect(classifyIntent('सीने में दर्द हो रहा है')).toBe('HEALTH_URGENT')
    expect(classifyIntent("my friend can't breathe")).toBe('HEALTH_URGENT')
    expect(classifyIntent('where is the nearest doctor')).toBe('HEALTH')
    // "help" is an emergency word first; the emergency card carries 108 too.
    expect(classifyIntent('find medical help')).toBe('EMERGENCY')
  })

  it('puts emergency before everything and refuses to guess', () => {
    expect(classifyIntent('truck accident, need help')).toBe('EMERGENCY')
    expect(classifyIntent('restaurant nearby?')).toBe('UNKNOWN')
    expect(classifyIntent('')).toBe('UNKNOWN')
    expect(classifyIntent('what is the meaning of life')).toBe('UNKNOWN')
  })
})
