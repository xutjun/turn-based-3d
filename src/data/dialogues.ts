// 对话表（步骤 16，SPEC §14.2，DESIGN §11.9）。纯数据：改台词、选项、说话人的小动作只改这里。
//
// - speaker 是“角色位”而不是具体单位：leader = 探索中的队长（烬刃），boss = 深渊魔将；由界面层映射到单位（名字、动作）。
// - name 省略时显示该单位的名字（队长为“烬刃”，DESIGN §9.10 F1）。
// - aside 是括号里的神态说明（如“狂笑”），对话框里显示为斜体的“（狂笑）”，不算进逐字显示的正文。
// - emote 是说话人说这句时做的小动作，姿态见下方 DIALOGUE_EMOTES。
// - 最后一句之后显示 choices；action：startBattle = 进入战斗，close = 关闭对话框、回到自由移动。

export type DialogueSpeaker = 'leader' | 'boss';
export type DialogueAction = 'startBattle' | 'close';
export type DialogueEmote = 'laugh' | 'roar' | 'point' | 'none';

export interface DialogueLine {
  speaker: DialogueSpeaker;
  /** 显示名；省略时用单位名 */
  name?: string;
  text: string;
  /** 括号里的神态说明，如“狂笑” */
  aside?: string;
  /** 说话人做的小动作 */
  emote?: DialogueEmote;
}

export interface DialogueChoice {
  label: string;
  action: DialogueAction;
  /** 键盘快捷键，例：'1' / '2' */
  hotkey?: string;
}

export interface DialogueDef {
  id: string;
  lines: DialogueLine[];
  /** 最后一句之后显示 */
  choices: DialogueChoice[];
}

/** 合法的取值（数据校验用） */
export const DIALOGUE_SPEAKERS: readonly DialogueSpeaker[] = ['leader', 'boss'];
export const DIALOGUE_ACTIONS: readonly DialogueAction[] = ['startBattle', 'close'];
export const DIALOGUE_EMOTE_IDS: readonly DialogueEmote[] = ['laugh', 'roar', 'point', 'none'];

export const DIALOGUES: Record<string, DialogueDef> = {
  bossChallenge: {
    id: 'bossChallenge',
    lines: [
      { speaker: 'leader', text: '深渊魔将，你的末日到了，准备受死吧！', emote: 'point' },
      { speaker: 'boss', text: '就凭你们几个凡人，也想来挑战我？', aside: '狂笑', emote: 'laugh' },
    ],
    choices: [
      { label: '我准备好了', action: 'startBattle', hotkey: '1' },
      { label: '再等等', action: 'close', hotkey: '2' },
    ],
  },
};

/** 点击 Boss 时打开的对话 */
export const BOSS_DIALOGUE_ID = 'bossChallenge';

/**
 * 说话时的小动作（render/units/UnitView.setGesture）：相对站姿的关节偏移（与进攻动作姿态同一套通道名），
 * 说这句时淡入并保持，换人说话 / 对话结束时淡出。wobble 是叠加在上面的抖动（狂笑时肩膀、头一颤一颤），
 * 偏移 × sin(2π·hz·t)。没有该关节的模型自动忽略对应通道。
 */
export interface EmotePose {
  pose: Record<string, number>;
  wobble?: { pose: Record<string, number>; hz: number };
}

export const DIALOGUE_EMOTES: Record<Exclude<DialogueEmote, 'none'>, EmotePose> = {
  /** 骑士：右臂前举，刀尖指向对方（weapon.aim 把刀尖拧向正前方），身体略向右前转、挺胸 */
  point: {
    pose: {
      'shoulderR.x': -1.42,
      'shoulderR.z': 0.1,
      'elbowR.x': 0.12,
      'weapon.aim': 1,
      'weapon.aimPitch': 0.12,
      'spine.y': -0.22,
      'chest.x': -0.06,
      'head.y': 0.12,
      'shoulderL.x': 0.12,
      'shoulderL.z': 0.18,
    },
  },
  /** Boss 狂笑：仰头、上身后仰、双翼张开、双臂向两侧摊开，肩膀和头随笑声一颤一颤 */
  laugh: {
    pose: {
      'head.x': -0.6,
      'chest.x': -0.22,
      'spine.x': -0.16,
      // Boss 的翼：y 为负是向两侧展开（为正会收到背后）
      'wingL.y': -0.6,
      'wingR.y': 0.6,
      'wingL.z': 0.25,
      'wingR.z': -0.25,
      'shoulderL.z': 0.3,
      'shoulderR.z': -0.25,
      'elbowL.x': -0.4,
      'elbowR.x': -0.2,
    },
    wobble: { pose: { 'chest.x': 0.05, 'head.x': 0.07, 'shoulderL.z': 0.05, 'shoulderR.z': -0.05 }, hz: 5.5 },
  },
  /** Boss 怒吼（备用）：前倾、张翼、双臂下压 */
  roar: {
    pose: {
      'head.x': -0.2,
      'chest.x': 0.15,
      'spine.x': 0.1,
      'wingL.y': 0.85,
      'wingR.y': -0.85,
      'shoulderL.z': 0.4,
      'shoulderR.z': -0.4,
    },
    wobble: { pose: { 'head.y': 0.04 }, hz: 9 },
  },
};
