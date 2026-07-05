// Global constants. Pure data — safe to import anywhere (main, worker, tests).

export const CHUNK = 16;          // chunk x/z size
export const HEIGHT = 128;        // world height
export const SEA_LEVEL = 48;

export const RENDER_DIST = 8;     // chunks
export const DAY_TICKS = 24000;   // one full day/night cycle
export const TICKS_PER_SEC = 20;  // MC tick rate (day cycle = 20 real minutes)

// Player physics (blocks, seconds)
export const GRAVITY = 32;
export const JUMP_VEL = 8.6;
export const WALK_SPEED = 4.317;
export const SPRINT_SPEED = 5.612;
export const SNEAK_SPEED = 1.31;
export const FLY_SPEED = 10.9;
export const SWIM_SPEED = 2.2;
export const REACH = 4.5;

export const PLAYER = { width: 0.6, height: 1.8, eye: 1.62 };

export const MAX_HEALTH = 20;
export const MAX_HUNGER = 20;
export const MAX_AIR = 10;        // seconds of breath underwater

export const STACK_MAX = 64;
