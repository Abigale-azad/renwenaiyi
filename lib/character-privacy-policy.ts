// Evaluated by the executor, not by the model's willingness to obey a prompt.
export function isPrivateChatLookup(id: string): boolean {
  return ["builtin_phone_lookup_wechat_contacts", "builtin_phone_lookup_wechat_messages", "builtin_phone_lookup_chat_history", "builtin_phone_lookup_people_brief"].includes(id);
}
