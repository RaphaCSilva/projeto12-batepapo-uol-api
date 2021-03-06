import express, {json} from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import chalk from 'chalk';
import dayjs from "dayjs";
import joi from "joi";

dotenv.config();

const app = express();
app.use(cors());
app.use(json());

let db;
const mongoClient = new MongoClient(process.env.MONGO_URL);
const promise = mongoClient.connect();
promise.then(() => {
  db = mongoClient.db("bate-papo-uol");
  console.log("conectou no banco");
});
promise.catch((e) => console.log("erro na conexão com o banco", e))

app.post("/participants", async (req, res) => {
    const participante = req.body; //{name: "joão"}
    const participanteSchema = joi.object({
        name: joi.string().required()
    });
    const {error} = participanteSchema.validate(participante, { abortEarly: false });
    if(error){
        console.log(error);
        return res.sendStatus(422);
    }
    
    try {
        const userJaExiste = await db.collection("participantes").findOne({name: participante.name});
        if(userJaExiste){
            return res.sendStatus(409);
        }
        await db.collection("participantes").insertOne({name: participante.name, lastStatus: Date.now()})
        await db.collection("mensagens").insertOne({
            from: participante.name,
            to: 'Todos',
            text: 'entra na sala ...',
            type: 'status',
            time: dayjs().format('HH:mm:ss')
        })

        res.sendStatus(201);


    } catch (e) {
        console.log(e);
        return res.send("Erro ao registrar");
    }

});

app.get("/participants", async (req,res) => {
    try {
        const participantes = await db.collection("participantes").find().toArray();
        res.send(participantes);
    } catch (e) {
        console.log(e);
        return res.send("Erro ao obter participantes");
    }
});

app.post("/messages", async(req, res) => {
    const mensagem = req.body;
    const usuario = req.headers.user;
    const mensagemSchema = joi.object({
        to: joi.string().required(),
        text: joi.string().required(),
        type: joi.string().valid('private_message', 'message').required()
    });
    const {error} = mensagemSchema.validate(mensagem, {abortEarly: false});
    if(error){
        console.log(error);
        return res.sendStatus(422);
    }

    try {
        const participante = await db.collection("participantes").findOne({name: usuario});
        if(!participante){
            return res.sendStatus(422);
        }

        await db.collection("mensagens").insertOne({
            from: usuario,
            to: mensagem.to,
            text: mensagem.text,
            type: mensagem.type,
            time: dayjs().format('HH:mm:ss')
        });

        res.sendStatus(201);

    } catch (e) {
        console.log(e);
        return res.send("Erro ao consultar a lista de participantes");
    }

});

app.get("/messages", async (req, res) => {
    const limite = parseInt(req.query.limit);
    const usuario = req.headers.user;
    
    try {
        const mensagens = await db.collection("mensagens").find().toArray();
        const mensagens_filtradas = mensagens.filter( mensagem => {
          const para_ou_dele =  mensagem.to === usuario || mensagem.from === usuario || mensagem.to === "Todos";
          const publica = mensagem.type === "message" || mensagem.type === "status"; 
          
          return para_ou_dele || publica;
        });

        if(limite > 0){
           return res.send(mensagens_filtradas.slice(-limite));
        }

        res.send(mensagens_filtradas);

    } catch (e) {
        console.log(e);
        res.send("Erro ao consultar as mensagens");
    }

});

app.post("/status", async(req, res) => {
    const usuario = req.headers.user;
    try {
        const participante = await db.collection("participantes").findOne({name: usuario});
        if(!participante){
            return res.sendStatus(404);
        }
        await db.collection("participantes").updateOne({name: usuario}, {$set: {lastStatus: Date.now()}});
        res.sendStatus(200);

    } catch (e) {
        console.log(e);
        res.send("Erro ao tentar atualizar status");
    }

});

const tempo_checar = 15000;
const tempo_inativo = 10000

setInterval( async () => {
    const hora_inatividade = Date.now() - tempo_inativo;
    try {
        const participantes = await db.collection("participantes").find().toArray();
        const participantes_inativos = participantes.filter( participante => {
            if(participante.lastStatus <= hora_inatividade){
                return true;
            }
        });
        if(participantes_inativos.length > 0){
          const mensagens_adeus = [];
          for(let i = 0; i<participantes_inativos.length; i++){
            mensagens_adeus.push({
                from: participantes_inativos[i].name,
                to: 'Todos',
                text: 'sai da sala ...',
                type: 'status',
                time: dayjs().format("HH:mm:ss")
            });
            
            await db.collection("participantes").deleteOne({name: participantes_inativos[i].name});

          }
          await db.collection("mensagens").insertMany(mensagens_adeus);
        }

    } catch (e) {
        console.log("Erro ao tentar remover inativos", e);
    }
}, tempo_checar);


const porta = process.env.PORTA;
app.listen(porta, ()=> {
    console.log(chalk.bold.blue('servidor de pé na porta ' + porta));
});