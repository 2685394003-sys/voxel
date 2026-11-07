import { definePackageId } from '@forgeax/engine/pack/source';

/**
 * 本作新增的三个包的稳定身份。
 * GUID 一律由「包 ID + sourceKey」推导，因此这里的 UUID 一旦上线就不能再改，
 * 改了等于把资源身份换掉，历史内容全部失联。
 */
export const CITY_SCENE_PACKAGE_ID = definePackageId('019fb7ce-5000-7000-8000-000000000000');
export const CITY_PLUGIN_PACKAGE_ID = definePackageId('019fb7ce-5100-7000-8000-000000000000');
export const HUD_PACKAGE_ID = definePackageId('019fb7ce-5200-7000-8000-000000000000');

/** HUD 状态消息通道名。引擎与前端两侧共用。 */
export const HUD_CHANNEL = 'voxel-warship/hud';
