import React, { useState } from 'react';
import { View, Text, TextInput, Button, Image } from 'react-native';
import { useStore, modelToOllamaId } from '../store/useStore';

export default function Conversation() {
  const { apiBase, provider, model, customOllamaModel, mature, tweakMode, sessionId, characters, selected, turns, set, pushTurn, startSession, incUsage } = useStore();
  const [text, setText] = useState('');
  const [useRag, setUseRag] = useState(true);
  const [reviewProv, setReviewProv] = useState<'mock'|'openai'|'ollama'>('openai');
  const [reviewModel, setReviewModel] = useState('gpt-5-mini');
  const [short, setShort] = useState(true);

  const send = async () => {
    if (!text.trim()) return;
    if (!sessionId) await startSession();
    pushTurn({ role: 'player', speaker: 'player', text });
    try {
      const r = await fetch(`${apiBase}/api/convo/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, player_text: text, scene_context: {}, characters: characters.filter(c=>selected.includes(c.id)).map(c=>({name:c.name, system_prompt:c.system_prompt||''})), provider, model: provider==='ollama' ? modelToOllamaId(model as any, customOllamaModel) : model, mature, tweakMode, useRag, reviewer_provider: reviewProv, reviewer_model: reviewModel, style_short: short })
      }).then(r=>r.json());
      incUsage(model, 'in', Math.max(1, Math.round(text.length/4)));
      r.turns?.forEach((t:any)=> {
        pushTurn({ role: 'npc', speaker: t.speaker, text: t.text });
        incUsage(model, 'out', Math.max(1, Math.round(String(t.text).length/4)));
      });
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

      <View style={{flexDirection:'row', alignItems:'center', marginBottom:8}}>
        <Text>RAG:</Text>
        <Button title={useRag ? 'On' : 'Off'} onPress={()=>setUseRag(!useRag)} />
        <View style={{width:8}} />
        <Button title={`Reviewer: ${reviewProv}`} onPress={()=> setReviewProv(reviewProv==='openai'?'ollama':reviewProv==='ollama'?'mock':'openai')} />
        <View style={{width:8}} />
        <TextInput value={reviewModel} onChangeText={setReviewModel} placeholder="reviewer model" style={{flex:1, borderWidth:1, borderColor:'#ccc', borderRadius:6, padding:6}} />
        <View style={{width:8}} />
        <Button title={short? 'Short ✓':'Short ✗'} onPress={()=>setShort(!short)} />
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
