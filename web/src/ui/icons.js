// Material Symbols (Rounded), Apache License 2.0, bundled at build time.

import mic from '@material-symbols/svg-400/rounded/mic-fill.svg?raw';
import micOff from '@material-symbols/svg-400/rounded/mic_off-fill.svg?raw';
import cam from '@material-symbols/svg-400/rounded/videocam-fill.svg?raw';
import camOff from '@material-symbols/svg-400/rounded/videocam_off-fill.svg?raw';
import screen from '@material-symbols/svg-400/rounded/present_to_all.svg?raw';
import screenOff from '@material-symbols/svg-400/rounded/cancel_presentation.svg?raw';
import hand from '@material-symbols/svg-400/rounded/back_hand.svg?raw';
import handFill from '@material-symbols/svg-400/rounded/back_hand-fill.svg?raw';
import smile from '@material-symbols/svg-400/rounded/add_reaction.svg?raw';
import more from '@material-symbols/svg-400/rounded/more_vert.svg?raw';
import leave from '@material-symbols/svg-400/rounded/call_end-fill.svg?raw';
import info from '@material-symbols/svg-400/rounded/info.svg?raw';
import lock from '@material-symbols/svg-400/rounded/lock-fill.svg?raw';
import unlock from '@material-symbols/svg-400/rounded/lock_open.svg?raw';
import chat from '@material-symbols/svg-400/rounded/chat.svg?raw';
import people from '@material-symbols/svg-400/rounded/group.svg?raw';
import gear from '@material-symbols/svg-400/rounded/settings.svg?raw';
import copy from '@material-symbols/svg-400/rounded/content_copy.svg?raw';
import share from '@material-symbols/svg-400/rounded/share.svg?raw';
import record from '@material-symbols/svg-400/rounded/radio_button_checked.svg?raw';
import pin from '@material-symbols/svg-400/rounded/keep.svg?raw';
import pinFill from '@material-symbols/svg-400/rounded/keep-fill.svg?raw';
import pip from '@material-symbols/svg-400/rounded/picture_in_picture_alt.svg?raw';
import clip from '@material-symbols/svg-400/rounded/attach_file.svg?raw';
import send from '@material-symbols/svg-400/rounded/send-fill.svg?raw';
import close from '@material-symbols/svg-400/rounded/close.svg?raw';
import check from '@material-symbols/svg-400/rounded/check.svg?raw';
import grid from '@material-symbols/svg-400/rounded/grid_view.svg?raw';
import spotlight from '@material-symbols/svg-400/rounded/view_sidebar.svg?raw';
import expand from '@material-symbols/svg-400/rounded/fullscreen.svg?raw';
import keyboard from '@material-symbols/svg-400/rounded/keyboard.svg?raw';
import download from '@material-symbols/svg-400/rounded/download.svg?raw';
import speaker from '@material-symbols/svg-400/rounded/volume_up.svg?raw';
import earpiece from '@material-symbols/svg-400/rounded/phone_in_talk.svg?raw';
import warn from '@material-symbols/svg-400/rounded/warning.svg?raw';
import user from '@material-symbols/svg-400/rounded/person.svg?raw';
import verified from '@material-symbols/svg-400/rounded/verified_user-fill.svg?raw';
import shield from '@material-symbols/svg-400/rounded/encrypted.svg?raw';
import handshake from '@material-symbols/svg-400/rounded/handshake-fill.svg?raw';
import newMeeting from '@material-symbols/svg-400/rounded/video_call-fill.svg?raw';
import link from '@material-symbols/svg-400/rounded/link.svg?raw';
import back from '@material-symbols/svg-400/rounded/arrow_back.svg?raw';
import chevron from '@material-symbols/svg-400/rounded/keyboard_arrow_down.svg?raw';
import door from '@material-symbols/svg-400/rounded/logout.svg?raw';
import devices from '@material-symbols/svg-400/rounded/devices.svg?raw';
import dark from '@material-symbols/svg-400/rounded/dark_mode.svg?raw';
import light from '@material-symbols/svg-400/rounded/light_mode.svg?raw';
import help from '@material-symbols/svg-400/rounded/help.svg?raw';
import addPerson from '@material-symbols/svg-400/rounded/person_add.svg?raw';
import network from '@material-symbols/svg-400/rounded/lan.svg?raw';
import palette from '@material-symbols/svg-400/rounded/palette.svg?raw';
import privacy from '@material-symbols/svg-400/rounded/shield_person.svg?raw';
import tune from '@material-symbols/svg-400/rounded/tune.svg?raw';
import groupOff from '@material-symbols/svg-400/rounded/group_off.svg?raw';
import person from '@material-symbols/svg-400/rounded/person-fill.svg?raw';
import schedule from '@material-symbols/svg-400/rounded/schedule.svg?raw';

const raw = {
  mic, micOff, cam, camOff, screen, screenOff, hand, handFill, smile, more, leave, info, lock, unlock, chat, people,
  gear, copy, share, record, pin, pinFill, pip, clip, send, close, check, grid, spotlight, expand, keyboard,
  download, speaker, earpiece, warn, user, verified, shield, handshake, newMeeting, link, back, chevron, door,
  devices, dark, light, help, addPerson, network, palette, privacy, tune, groupOff, person, schedule,
};

const cleaned = {};
for (const [name, svg] of Object.entries(raw)) {
  cleaned[name] = svg
    .replace(/\s(width|height)="\d+"/g, '')
    .replace('<svg ', '<svg aria-hidden="true" focusable="false" fill="currentColor" ');
}

export const icons = cleaned;

/** Builds an element containing an icon. */
export function icon(name, cls = 'ico') {
  const span = document.createElement('span');
  span.className = cls;
  span.innerHTML = cleaned[name] || '';
  return span;
}
