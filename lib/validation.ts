import {z} from 'zod';
const id=z.string().min(1).max(150);
const styles=z.array(z.string().max(80)).max(30);
const optionalText=(max:number)=>z.string().max(max).optional();
const game=z.object({id,name:z.string().trim().min(1).max(150),min:z.number().int().min(1).max(100),max:z.number().int().min(1).max(100),minutes:z.number().int().min(1).max(10000),weight:z.union([z.literal(1),z.literal(2),z.literal(3)]),tags:styles,description:z.string().max(5000),color:z.string().regex(/^#[0-9a-fA-F]{6}$/),image:optionalText(3000),bgg:optionalText(30),rules:optionalText(3000),notes:optionalText(5000)}).refine(g=>g.max>=g.min,'Maximum players must be at least minimum players.');
const person=z.object({id,name:z.string().trim().min(1).max(80),tags:styles,notes:z.string().max(2000)});
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d=>{const parsed=new Date(d+'T12:00:00Z');return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===d},'Invalid date.');
const play=z.object({id,gameId:id,gameName:z.string().min(1).max(150),date,people:z.array(id).max(1000),ratings:z.record(z.union([z.literal(-1),z.literal(0),z.literal(1)])),notes:z.record(z.string().max(1000))});
export const shelfSchema=z.object({games:z.array(game).max(2000),people:z.array(person).max(1000),plays:z.array(play).max(10000)}).superRefine((s,ctx)=>{
 for(const key of ['games','people','plays'] as const)if(new Set(s[key].map(x=>x.id)).size!==s[key].length)ctx.addIssue({code:'custom',message:'Duplicate record IDs.'});
 const people=new Set(s.people.map(p=>p.id));
 for(const p of s.plays){if(new Set(p.people).size!==p.people.length||p.people.some(id=>!people.has(id))||Object.keys(p.ratings).some(id=>!p.people.includes(id))||Object.keys(p.notes).some(id=>!p.people.includes(id)))ctx.addIssue({code:'custom',message:'A session refers to an unknown or unselected player.'})}
});
