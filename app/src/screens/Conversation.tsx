import React, { useState } from 'react';
import { View, Text, TextInput, Button, Image } from 'react-native';
import { useStore } from '../store/useStore';

export default function Conversation() {
  const { apiBase, provider, model, sessionId, characters, turns, set, pushTurn } = useStore();
  const [text, setText] = useState('');

  const send = async () => {
    if (!text.trim()) return;
    pushTurn({ role: 'player', speaker: 'player', text });
    try {
      const r = await fetch(`${apiBase}/api/convo/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, player_text: text, scene_context: {}, characters: characters.map(c=>({name:c.name, system_prompt:c.system_prompt||''})), provider })
      }).then(r=>r.json());
      r.turns?.forEach((t:any)=> pushTurn({ role: 'npc', speaker: t.speaker, text: t.text }));
    } catch (e) {
      pushTurn({ role: 'npc', speaker: 'System', text: `Error: ${String(e)}` });
    }
    setText('');
  };

  return (
    <View style={{flex:1, padding:12}}>
      <View style={{flexDirection:'row', justifyContent:'space-between', marginBottom:8}}>
        <Text>Provider: {provider}</Text>
        <Text>Model: {model}</Text>
      </View>
      <View style={{flex:1}}>
        {turns.map((t, i)=> (
          <View key={i} style={{marginVertical:6, alignSelf: t.role==='player' ? 'flex-end' : 'flex-start', maxWidth:'85%'}}>
            {t.role==='npc' && (
              <View style={{flexDirection:'row', alignItems:'flex-start'}}>
                {/* Avatar placeholder; actual lookup by speaker */}
                <View style={{width:28, height:28, borderRadius:14, backgroundColor:'#ddd', marginRight:8}} />
                <View style={{backgroundColor:'#f1f1f1', padding:8, borderRadius:8}}>
                  <Text style={{fontWeight:'600'}}>{t.speaker}: </Text>
                  <Text>{t.text}</Text>
                </View>
              </View>
            )}
            {t.role==='player' && (
              <View style={{backgroundColor:'#d1eaff', padding:8, borderRadius:8}}>
                <Text>{t.text}</Text>
              </View>
            )}
          </View>
        ))}
      </View>
      <View style={{flexDirection:'row', alignItems:'center'}}>
        <TextInput value={text} onChangeText={setText} placeholder="Type a message or /LLM ..." style={{flex:1, borderWidth:1, borderColor:'#ccc', borderRadius:6, padding:8}} />
        <Button title="Send" onPress={send} />
      </View>
    </View>
  );
}

